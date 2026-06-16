import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EventEnvelope,
  PaymentOutcomeEvent,
  PaymentStatus,
  PaymentView,
  ReservationExpiredEvent,
  ReservationHeldEvent,
  ReservationStatus,
  ReservationView,
  ROUTING_KEYS,
  UserPrincipal,
} from '../../../packages/contracts/src';
import { numberEnv } from '../../../packages/core/src/config';
import { logError, logInfo } from '../../../packages/core/src/logger';
import { DbClient, PostgresService } from '../../../packages/core/src/postgres';
import {
  appendOutbox,
  publishPendingOutbox,
  RabbitMqService,
  recordInbox,
} from '../../../packages/core/src/rabbitmq';
import { MockPaymentClient } from './mock-payment-client';
import { PaymentExpiredException } from './payment.errors';

interface PaymentRow {
  id: string;
  reservation_id: string;
  seat_id: string;
  user_id: string;
  status: PaymentStatus;
  amount_cents: number;
  currency: string;
  created_at: Date;
  expires_at: Date;
  completed_at: Date | null;
}

interface WebhookEvent {
  id: string;
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed';
  data: {
    paymentId: string;
    reason?: string;
  };
}

type CompletionResult =
  | { type: 'completed'; payment: PaymentRow }
  | { type: 'expired'; payment: PaymentRow };

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private outboxTimer?: NodeJS.Timeout;

  constructor(
    private readonly postgres: PostgresService,
    private readonly rabbit: RabbitMqService,
    private readonly paymentClient: MockPaymentClient,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbit.consume<ReservationHeldEvent | ReservationExpiredEvent>({
      queue: 'payment-service.reservation-events',
      bindingKeys: [
        ROUTING_KEYS.reservationHeld,
        ROUTING_KEYS.reservationExpired,
      ],
      handler: async (event) => {
        if (event.type === 'reservation.hold_created') {
          await this.createPendingPayment(
            event as EventEnvelope<ReservationHeldEvent>,
          );
          return;
        }

        await this.expireFromReservation(
          event as EventEnvelope<ReservationExpiredEvent>,
        );
      },
    });

    this.outboxTimer = setInterval(
      () => void this.flushOutbox(),
      numberEnv('OUTBOX_PUBLISH_INTERVAL_MS', 1000),
    );
    this.outboxTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.outboxTimer) {
      clearInterval(this.outboxTimer);
    }
  }

  async completePayment(
    paymentId: string,
    user: UserPrincipal,
    traceId?: string,
  ): Promise<{ payment: PaymentView; reservation: ReservationView }> {
    await this.waitForPaymentProjection(paymentId);

    const completion = await this.postgres.transaction(async (client) => {
      const payment = await this.getPaymentForUpdate(client, paymentId);

      if (!payment || payment.user_id !== user.id) {
        throw new NotFoundException('Payment not found');
      }

      if (payment.status === PaymentStatus.Expired) {
        return { type: 'expired', payment } satisfies CompletionResult;
      }

      if (payment.status !== PaymentStatus.Pending) {
        throw new ConflictException('Payment is already completed');
      }

      if (payment.expires_at.getTime() <= Date.now()) {
        const expired = await this.markPaymentTerminal({
          client,
          payment,
          status: PaymentStatus.Expired,
          traceId,
          reason: 'payment_expired',
        });
        return { type: 'expired', payment: expired } satisfies CompletionResult;
      }

      await this.paymentClient.authorize({
        paymentId: payment.id,
        amount: payment.amount_cents,
        currency: payment.currency,
      });

      const completed = await this.markPaymentTerminal({
        client,
        payment,
        status: PaymentStatus.Succeeded,
        traceId,
      });
      return {
        type: 'completed',
        payment: completed,
      } satisfies CompletionResult;
    });

    void this.flushOutbox();

    if (completion.type === 'expired') {
      throw new PaymentExpiredException();
    }

    return toCheckoutResponse(completion.payment, ReservationStatus.Reserved);
  }

  async handleWebhook(
    dto: unknown,
    traceId?: string,
  ): Promise<{ received: true; duplicate: boolean }> {
    const event = parseWebhookEvent(dto);

    const duplicate = await this.postgres.transaction(async (client) => {
      const inserted = await client.query(
        `
          INSERT INTO payment.webhook_events (event_id, event_type, payload)
          VALUES ($1, $2, $3)
          ON CONFLICT (event_id) DO NOTHING
        `,
        [event.id, event.type, JSON.stringify(event)],
      );

      if ((inserted.rowCount ?? 0) === 0) {
        return true;
      }

      if (event.type === 'payment_intent.succeeded') {
        await this.completeFromWebhook(client, event.data.paymentId, traceId);
      } else {
        await this.failFromWebhook(
          client,
          event.data.paymentId,
          traceId,
          event.data.reason ?? 'payment_failed',
        );
      }

      return false;
    });

    void this.flushOutbox();
    return { received: true, duplicate };
  }

  async ready(): Promise<boolean> {
    const [db, rabbit] = await Promise.all([
      this.postgres.ready(),
      this.rabbit.ready(),
    ]);
    return db && rabbit;
  }

  private async waitForPaymentProjection(paymentId: string): Promise<void> {
    const deadline = Date.now() + numberEnv('PAYMENT_READY_WAIT_MS', 1000);

    while (Date.now() < deadline) {
      const found = await this.postgres.query(
        'SELECT 1 FROM payment.payments WHERE id = $1',
        [paymentId],
      );
      if ((found.rowCount ?? 0) > 0) {
        return;
      }

      await sleep(50);
    }
  }

  private async createPendingPayment(
    event: EventEnvelope<ReservationHeldEvent>,
  ): Promise<void> {
    await this.postgres.transaction(async (client) => {
      if (
        !(await recordInbox({
          client,
          eventId: event.id,
          consumer: 'payment-service',
        }))
      ) {
        return;
      }

      await client.query(
        `
          INSERT INTO payment.payments (
            id, reservation_id, seat_id, user_id, status, amount_cents,
            currency, created_at, expires_at
          )
          VALUES ($1, $2, $3, $4, 'pending', $5, $6, now(), $7)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          event.data.paymentId,
          event.data.reservationId,
          event.data.seatId,
          event.data.userId,
          event.data.amount,
          event.data.currency,
          event.data.expiresAt,
        ],
      );
      logInfo({
        action: 'payment_created_from_hold',
        eventId: event.id,
        paymentId: event.data.paymentId,
        userId: event.data.userId,
      });
    });
  }

  private async expireFromReservation(
    event: EventEnvelope<ReservationExpiredEvent>,
  ): Promise<void> {
    await this.postgres.transaction(async (client) => {
      if (
        !(await recordInbox({
          client,
          eventId: event.id,
          consumer: 'payment-service',
        }))
      ) {
        return;
      }

      const payment = await this.getPaymentForUpdate(
        client,
        event.data.paymentId,
      );
      if (!payment || payment.status !== PaymentStatus.Pending) {
        return;
      }

      await this.markPaymentTerminal({
        client,
        payment,
        status: PaymentStatus.Expired,
        reason: event.data.reason,
        traceId: event.traceId,
      });
    });
    void this.flushOutbox();
  }

  private async completeFromWebhook(
    client: DbClient,
    paymentId: string,
    traceId?: string,
  ): Promise<void> {
    const payment = await this.getPaymentForUpdate(client, paymentId);
    if (!payment || payment.status !== PaymentStatus.Pending) {
      return;
    }

    await this.markPaymentTerminal({
      client,
      payment,
      status: PaymentStatus.Succeeded,
      traceId,
    });
  }

  private async failFromWebhook(
    client: DbClient,
    paymentId: string,
    traceId: string | undefined,
    reason: string,
  ): Promise<void> {
    const payment = await this.getPaymentForUpdate(client, paymentId);
    if (!payment || payment.status !== PaymentStatus.Pending) {
      return;
    }

    await this.markPaymentTerminal({
      client,
      payment,
      status: PaymentStatus.Failed,
      reason,
      traceId,
    });
  }

  private async getPaymentForUpdate(
    client: DbClient,
    paymentId: string,
  ): Promise<PaymentRow | undefined> {
    const result = await client.query<PaymentRow>(
      `
        SELECT id, reservation_id, seat_id, user_id, status, amount_cents,
               currency, created_at, expires_at, completed_at
        FROM payment.payments
        WHERE id = $1
        FOR UPDATE
      `,
      [paymentId],
    );

    return result.rows[0];
  }

  private async markPaymentTerminal(input: {
    client: DbClient;
    payment: PaymentRow;
    status:
      | PaymentStatus.Succeeded
      | PaymentStatus.Failed
      | PaymentStatus.Expired;
    reason?: string;
    traceId?: string;
  }): Promise<PaymentRow> {
    const completedAt =
      input.status === PaymentStatus.Succeeded ? 'now()' : 'completed_at';
    const result = await input.client.query<PaymentRow>(
      `
        UPDATE payment.payments
        SET status = $2,
            completed_at = ${completedAt}
        WHERE id = $1
          AND status = 'pending'
        RETURNING id, reservation_id, seat_id, user_id, status, amount_cents,
                  currency, created_at, expires_at, completed_at
      `,
      [input.payment.id, input.status],
    );
    const updated = result.rows[0] ?? {
      ...input.payment,
      status: input.status,
    };

    const routingKey =
      input.status === PaymentStatus.Succeeded
        ? ROUTING_KEYS.paymentSucceeded
        : input.status === PaymentStatus.Failed
          ? ROUTING_KEYS.paymentFailed
          : ROUTING_KEYS.paymentExpired;
    const eventType =
      input.status === PaymentStatus.Succeeded
        ? 'payment.succeeded'
        : input.status === PaymentStatus.Failed
          ? 'payment.failed'
          : 'payment.expired';

    await appendOutbox<PaymentOutcomeEvent>({
      client: input.client,
      producer: 'payment-service',
      routingKey,
      eventType,
      aggregateType: 'payment',
      aggregateId: updated.id,
      traceId: input.traceId,
      data: {
        paymentId: updated.id,
        reservationId: updated.reservation_id,
        seatId: updated.seat_id,
        userId: updated.user_id,
        amount: updated.amount_cents,
        currency: updated.currency,
        reason: input.reason,
      },
    });

    logInfo({
      action: 'payment_terminal_status',
      paymentId: updated.id,
      status: input.status,
      userId: updated.user_id,
    });

    return updated;
  }

  private async flushOutbox(): Promise<void> {
    try {
      await publishPendingOutbox({
        postgres: this.postgres,
        rabbit: this.rabbit,
        producer: 'payment-service',
      });
    } catch (error) {
      logError({ action: 'payment_outbox_flush_failed', error });
    }
  }
}

function parseWebhookEvent(dto: unknown): WebhookEvent {
  if (
    !isRecord(dto) ||
    typeof dto.id !== 'string' ||
    typeof dto.type !== 'string'
  ) {
    throw new UnprocessableEntityException('Invalid webhook event');
  }

  if (
    dto.type !== 'payment_intent.succeeded' &&
    dto.type !== 'payment_intent.payment_failed'
  ) {
    throw new UnprocessableEntityException('Unsupported webhook event');
  }

  const data = dto.data;
  if (!isRecord(data) || typeof data.paymentId !== 'string') {
    throw new UnprocessableEntityException('Invalid webhook event data');
  }

  return {
    id: dto.id,
    type: dto.type,
    data: {
      paymentId: data.paymentId,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
    },
  };
}

function toCheckoutResponse(
  payment: PaymentRow,
  reservationStatus: ReservationStatus,
): { payment: PaymentView; reservation: ReservationView } {
  return {
    payment: toPaymentView(payment),
    reservation: {
      id: payment.reservation_id,
      seatId: payment.seat_id,
      userId: payment.user_id,
      status: reservationStatus,
      paymentId: payment.id,
      createdAt: payment.created_at.toISOString(),
      expiresAt: payment.expires_at.toISOString(),
      ...(payment.completed_at
        ? { reservedAt: payment.completed_at.toISOString() }
        : {}),
    },
  };
}

function toPaymentView(payment: PaymentRow): PaymentView {
  return {
    id: payment.id,
    reservationId: payment.reservation_id,
    userId: payment.user_id,
    status: payment.status,
    amount: payment.amount_cents,
    currency: payment.currency,
    createdAt: payment.created_at.toISOString(),
    expiresAt: payment.expires_at.toISOString(),
    ...(payment.completed_at
      ? { completedAt: payment.completed_at.toISOString() }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

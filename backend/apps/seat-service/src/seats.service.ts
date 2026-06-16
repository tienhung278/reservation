import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PaymentOutcomeEvent,
  PaymentStatus,
  ReservationExpiredEvent,
  ReservationHeldEvent,
  ReservationStatus,
  ReservationView,
  ROUTING_KEYS,
  SeatStatus,
  SeatView,
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
import { SeatUnavailableError } from './seat.errors';

interface SeatRow {
  id: string;
  label: string;
  reservation_id: string | null;
  reservation_status: ReservationStatus | null;
}

interface ReservationRow {
  id: string;
  seat_id: string;
  user_id: string;
  status: ReservationStatus;
  payment_id: string;
  amount_cents: number;
  currency: string;
  created_at: Date;
  expires_at: Date;
  reserved_at: Date | null;
}

@Injectable()
export class SeatsService implements OnModuleInit, OnModuleDestroy {
  private outboxTimer?: NodeJS.Timeout;
  private sweeperTimer?: NodeJS.Timeout;

  constructor(
    private readonly postgres: PostgresService,
    private readonly rabbit: RabbitMqService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbit.consume<PaymentOutcomeEvent>({
      queue: 'seat-service.payment-events',
      bindingKeys: [
        ROUTING_KEYS.paymentSucceeded,
        ROUTING_KEYS.paymentFailed,
        ROUTING_KEYS.paymentExpired,
      ],
      handler: async (event) => {
        if (event.type === 'payment.succeeded') {
          await this.applyPaymentSucceeded(event.id, event.data);
          return;
        }

        await this.applyPaymentReleased(event.id, event.data);
      },
    });

    this.outboxTimer = setInterval(
      () => void this.flushOutbox(),
      numberEnv('OUTBOX_PUBLISH_INTERVAL_MS', 1000),
    );
    this.outboxTimer.unref?.();

    this.sweeperTimer = setInterval(
      () => void this.sweepExpiredHolds(),
      numberEnv('HOLD_SWEEP_INTERVAL_MS', 30000),
    );
    this.sweeperTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.outboxTimer) {
      clearInterval(this.outboxTimer);
    }
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
    }
  }

  async listSeats(): Promise<SeatView[]> {
    await this.sweepExpiredHolds();
    const rows = await this.postgres.query<SeatRow>(
      `
        SELECT s.id,
               s.label,
               active.id AS reservation_id,
               active.status AS reservation_status
        FROM seat.seats s
        LEFT JOIN LATERAL (
          SELECT id, status
          FROM seat.reservations r
          WHERE r.seat_id = s.id
            AND r.status IN ('pending_payment', 'reserved')
          ORDER BY CASE WHEN r.status = 'reserved' THEN 0 ELSE 1 END,
                   r.created_at DESC
          LIMIT 1
        ) active ON true
        ORDER BY s.id
      `,
    );

    return rows.rows.map(toSeatView);
  }

  async getSeat(seatId: string): Promise<SeatView> {
    await this.sweepExpiredHolds();
    const result = await this.postgres.query<SeatRow>(
      `
        SELECT s.id,
               s.label,
               active.id AS reservation_id,
               active.status AS reservation_status
        FROM seat.seats s
        LEFT JOIN LATERAL (
          SELECT id, status
          FROM seat.reservations r
          WHERE r.seat_id = s.id
            AND r.status IN ('pending_payment', 'reserved')
          ORDER BY CASE WHEN r.status = 'reserved' THEN 0 ELSE 1 END,
                   r.created_at DESC
          LIMIT 1
        ) active ON true
        WHERE s.id = $1
      `,
      [seatId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('Seat not found');
    }

    return toSeatView(row);
  }

  async selectSeat(
    dto: unknown,
    user: UserPrincipal,
    traceId?: string,
  ): Promise<{ reservation: ReservationView; payment: PaymentResponse }> {
    const seatId = parseSelectDto(dto);
    const amount = numberEnv('SEAT_PRICE_CENTS', 5000);
    const currency = 'usd';
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + numberEnv('HOLD_TTL_SECONDS', 900) * 1000,
    );
    const reservationId = randomUUID();
    const paymentId = randomUUID();

    try {
      const reservation = await this.postgres.transaction(async (client) => {
        await this.expirePendingHolds(client, traceId);
        await this.lockSeatOrThrow(client, seatId);

        const inserted = await client.query<ReservationRow>(
          `
            INSERT INTO seat.reservations (
              id, seat_id, user_id, status, payment_id, amount_cents, currency,
              created_at, expires_at
            )
            VALUES ($1, $2, $3, 'pending_payment', $4, $5, $6, $7, $8)
            RETURNING id, seat_id, user_id, status, payment_id, amount_cents,
                      currency, created_at, expires_at, reserved_at
          `,
          [
            reservationId,
            seatId,
            user.id,
            paymentId,
            amount,
            currency,
            createdAt,
            expiresAt,
          ],
        );

        const row = inserted.rows[0];
        if (!row) {
          throw new SeatUnavailableError();
        }

        await appendOutbox<ReservationHeldEvent>({
          client,
          producer: 'seat-service',
          routingKey: ROUTING_KEYS.reservationHeld,
          eventType: 'reservation.hold_created',
          aggregateType: 'reservation',
          aggregateId: reservationId,
          traceId,
          data: {
            reservationId,
            paymentId,
            seatId,
            userId: user.id,
            amount,
            currency,
            expiresAt: expiresAt.toISOString(),
          },
        });

        return toReservationView(row);
      });

      void this.flushOutbox();

      return {
        reservation,
        payment: {
          id: paymentId,
          reservationId,
          userId: user.id,
          status: PaymentStatus.Pending,
          amount,
          currency,
          createdAt: reservation.createdAt,
          expiresAt: reservation.expiresAt,
        },
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SeatUnavailableError();
      }

      throw error;
    }
  }

  async sweepExpiredHolds(): Promise<number> {
    try {
      const count = await this.postgres.transaction(async (client) =>
        this.expirePendingHolds(client),
      );
      if (count > 0) {
        void this.flushOutbox();
      }

      return count;
    } catch (error) {
      logError({ action: 'seat_hold_sweep_failed', error });
      return 0;
    }
  }

  async ready(): Promise<boolean> {
    const [db, rabbit] = await Promise.all([
      this.postgres.ready(),
      this.rabbit.ready(),
    ]);
    return db && rabbit;
  }

  private async applyPaymentSucceeded(
    eventId: string,
    event: PaymentOutcomeEvent,
  ): Promise<void> {
    await this.postgres.transaction(async (client) => {
      if (!(await recordInbox({ client, eventId, consumer: 'seat-service' }))) {
        return;
      }

      await client.query(
        `
          UPDATE seat.reservations
          SET status = 'reserved',
              reserved_at = now()
          WHERE id = $1
            AND payment_id = $2
            AND status = 'pending_payment'
        `,
        [event.reservationId, event.paymentId],
      );
      logInfo({
        action: 'seat_reserved_from_payment',
        eventId,
        userId: event.userId,
        paymentId: event.paymentId,
      });
    });
  }

  private async applyPaymentReleased(
    eventId: string,
    event: PaymentOutcomeEvent,
  ): Promise<void> {
    await this.postgres.transaction(async (client) => {
      if (!(await recordInbox({ client, eventId, consumer: 'seat-service' }))) {
        return;
      }

      await client.query(
        `
          UPDATE seat.reservations
          SET status = 'expired',
              released_at = now()
          WHERE id = $1
            AND payment_id = $2
            AND status = 'pending_payment'
        `,
        [event.reservationId, event.paymentId],
      );
      logInfo({
        action: 'seat_released_from_payment',
        eventId,
        userId: event.userId,
        paymentId: event.paymentId,
      });
    });
  }

  private async lockSeatOrThrow(
    client: DbClient,
    seatId: string,
  ): Promise<void> {
    const seat = await client.query(
      'SELECT id FROM seat.seats WHERE id = $1 FOR UPDATE',
      [seatId],
    );
    if ((seat.rowCount ?? 0) === 0) {
      throw new NotFoundException('Seat not found');
    }
  }

  private async expirePendingHolds(
    client: DbClient,
    traceId?: string,
  ): Promise<number> {
    const expired = await client.query<{
      id: string;
      payment_id: string;
      seat_id: string;
      user_id: string;
    }>(
      `
        WITH expired AS (
          SELECT id
          FROM seat.reservations
          WHERE status = 'pending_payment'
            AND expires_at <= now()
          ORDER BY expires_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE seat.reservations r
        SET status = 'expired',
            released_at = now()
        FROM expired
        WHERE r.id = expired.id
        RETURNING r.id, r.payment_id, r.seat_id, r.user_id
      `,
      [numberEnv('HOLD_SWEEP_BATCH_SIZE', 50)],
    );

    for (const row of expired.rows) {
      await appendOutbox<ReservationExpiredEvent>({
        client,
        producer: 'seat-service',
        routingKey: ROUTING_KEYS.reservationExpired,
        eventType: 'reservation.expired',
        aggregateType: 'reservation',
        aggregateId: row.id,
        traceId,
        data: {
          reservationId: row.id,
          paymentId: row.payment_id,
          seatId: row.seat_id,
          userId: row.user_id,
          reason: 'hold_expired',
        },
      });
    }

    return expired.rowCount ?? 0;
  }

  private async flushOutbox(): Promise<void> {
    await publishPendingOutbox({
      postgres: this.postgres,
      rabbit: this.rabbit,
      producer: 'seat-service',
    });
  }
}

export interface PaymentResponse {
  id: string;
  reservationId: string;
  userId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

function parseSelectDto(dto: unknown): string {
  if (
    !isRecord(dto) ||
    typeof dto.seatId !== 'string' ||
    dto.seatId.trim() === ''
  ) {
    throw new UnprocessableEntityException('seatId is required');
  }

  return dto.seatId;
}

function toSeatView(row: SeatRow): SeatView {
  const status =
    row.reservation_status === ReservationStatus.Reserved
      ? SeatStatus.Reserved
      : row.reservation_status === ReservationStatus.PendingPayment
        ? SeatStatus.Pending
        : SeatStatus.Available;

  return {
    id: row.id,
    label: row.label,
    status,
    available: status === SeatStatus.Available,
    ...(row.reservation_id ? { reservationId: row.reservation_id } : {}),
  };
}

function toReservationView(row: ReservationRow): ReservationView {
  return {
    id: row.id,
    seatId: row.seat_id,
    userId: row.user_id,
    status: row.status,
    paymentId: row.payment_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    ...(row.reserved_at ? { reservedAt: row.reserved_at.toISOString() } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

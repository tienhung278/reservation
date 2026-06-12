import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  CreatePendingPaymentInput,
  Payment,
  PaymentStatus,
} from './payment.types';
import { PaymentsRepository } from './payments.repository';

type PaymentFinalizer<TFinalized> = (
  payment: Payment,
) => TFinalized | Promise<TFinalized>;
type PaymentExpirationHandler = (payment: Payment) => unknown;
type PaymentCompletion<TFinalized> =
  | { type: 'completed'; payment: Payment; finalized: TFinalized }
  | { type: 'expired' };

const PAYMENT_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly paymentsRepository: PaymentsRepository,
  ) {}

  async createPendingPayment(
    input: CreatePendingPaymentInput,
  ): Promise<Payment> {
    const createdAt = input.createdAt ?? new Date();
    const payment: Payment = {
      id: randomUUID(),
      reservationId: input.reservationId,
      userId: input.userId,
      status: PaymentStatus.Pending,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PAYMENT_TTL_MS).toISOString(),
    };

    await this.paymentsRepository.create(payment);

    return payment;
  }

  async getPayment(paymentId: string): Promise<Payment> {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }

  async completePayment<TFinalized>(
    paymentId: string,
    userId: string,
    finalize: PaymentFinalizer<TFinalized>,
    expire?: PaymentExpirationHandler,
  ): Promise<{ payment: Payment; finalized: TFinalized }> {
    const completion = await this.databaseService.transaction<
      PaymentCompletion<TFinalized>
    >(async () => {
      const payment = await this.getPayment(paymentId);

      if (payment.userId !== userId) {
        throw new NotFoundException('Payment not found');
      }

      if (payment.status === PaymentStatus.Expired) {
        throw new ConflictException('Payment has expired');
      }

      if (payment.status !== PaymentStatus.Pending) {
        throw new ConflictException('Payment is already completed');
      }

      if (this.isExpired(payment)) {
        const expired = {
          ...payment,
          status: PaymentStatus.Expired,
        };
        await this.paymentsRepository.markExpired(payment.id);
        await expire?.(expired);
        return { type: 'expired' };
      }

      const finalized = await finalize(payment);
      const completed = {
        ...payment,
        status: PaymentStatus.Succeeded,
        completedAt: new Date().toISOString(),
      };
      await this.paymentsRepository.markSucceeded(completed);

      return { type: 'completed', payment: completed, finalized };
    });

    if (completion.type === 'expired') {
      throw new ConflictException('Payment has expired');
    }

    return { payment: completion.payment, finalized: completion.finalized };
  }

  private isExpired(payment: Payment): boolean {
    return Date.now() >= new Date(payment.expiresAt).getTime();
  }
}

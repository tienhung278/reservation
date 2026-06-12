import { Injectable } from '@nestjs/common';
import { and, eq, lte } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { payments, PaymentRow } from '../database/schema';
import { Payment, PaymentStatus } from './payment.types';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(payment: Payment): Promise<void> {
    await this.databaseService.db.insert(payments).values(payment).run();
  }

  async findById(paymentId: string): Promise<Payment | undefined> {
    const payment = await this.databaseService.db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .get();

    return payment ? toPayment(payment) : undefined;
  }

  async markExpired(paymentId: string): Promise<void> {
    await this.databaseService.db
      .update(payments)
      .set({ status: PaymentStatus.Expired })
      .where(eq(payments.id, paymentId))
      .run();
  }

  async markPendingExpired(paymentId: string): Promise<void> {
    await this.databaseService.db
      .update(payments)
      .set({ status: PaymentStatus.Expired })
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.status, PaymentStatus.Pending),
        ),
      )
      .run();
  }

  async markSucceeded(payment: Payment): Promise<void> {
    await this.databaseService.db
      .update(payments)
      .set({
        status: payment.status,
        completedAt: payment.completedAt,
      })
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.status, PaymentStatus.Pending),
        ),
      )
      .run();
  }

  async expirePendingPayments(nowIso: string): Promise<void> {
    await this.databaseService.db
      .update(payments)
      .set({ status: PaymentStatus.Expired })
      .where(
        and(
          eq(payments.status, PaymentStatus.Pending),
          lte(payments.expiresAt, nowIso),
        ),
      )
      .run();
  }
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    reservationId: row.reservationId,
    userId: row.userId,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt ?? undefined,
  };
}

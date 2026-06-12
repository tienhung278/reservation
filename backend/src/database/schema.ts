import { sql } from 'drizzle-orm';
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { PaymentStatus } from '../payments/payment.types';
import { ReservationStatus } from '../reservations/reservation.types';

export const seats = sqliteTable('seats', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  username: text('username').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const reservations = sqliteTable(
  'reservations',
  {
    id: text('id').primaryKey(),
    seatId: text('seat_id')
      .notNull()
      .references(() => seats.id),
    userId: text('user_id').notNull(),
    status: text('status', {
      enum: [
        ReservationStatus.PendingPayment,
        ReservationStatus.Reserved,
        ReservationStatus.Expired,
      ],
    }).notNull(),
    paymentId: text('payment_id').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    reservedAt: text('reserved_at'),
  },
  (table) => [
    uniqueIndex('reservations_one_active_per_seat')
      .on(table.seatId)
      .where(
        sql`${table.status} IN (${ReservationStatus.PendingPayment}, ${ReservationStatus.Reserved})`,
      ),
  ],
);

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  reservationId: text('reservation_id').notNull(),
  userId: text('user_id').notNull(),
  status: text('status', {
    enum: [
      PaymentStatus.Pending,
      PaymentStatus.Succeeded,
      PaymentStatus.Expired,
    ],
  }).notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  completedAt: text('completed_at'),
});

export type SessionRow = typeof sessions.$inferSelect;
export type ReservationRow = typeof reservations.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;

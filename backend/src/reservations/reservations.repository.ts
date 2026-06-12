import { Injectable } from '@nestjs/common';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { reservations, ReservationRow, seats } from '../database/schema';
import { Reservation, ReservationStatus } from './reservation.types';

@Injectable()
export class ReservationsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(reservation: Reservation): Promise<void> {
    await this.databaseService.db
      .insert(reservations)
      .values(reservation)
      .run();
  }

  async findById(reservationId: string): Promise<Reservation | undefined> {
    const reservation = await this.databaseService.db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .get();

    return reservation ? toReservation(reservation) : undefined;
  }

  async findExpiredPending(nowIso: string): Promise<Reservation[]> {
    const rows = await this.databaseService.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.status, ReservationStatus.PendingPayment),
          lte(reservations.expiresAt, nowIso),
        ),
      )
      .all();

    return rows.map(toReservation);
  }

  async expirePendingReservations(nowIso: string): Promise<void> {
    await this.databaseService.db
      .update(reservations)
      .set({ status: ReservationStatus.Expired })
      .where(
        and(
          eq(reservations.status, ReservationStatus.PendingPayment),
          lte(reservations.expiresAt, nowIso),
        ),
      )
      .run();
  }

  async expirePendingReservation(reservationId: string): Promise<void> {
    await this.databaseService.db
      .update(reservations)
      .set({ status: ReservationStatus.Expired })
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.status, ReservationStatus.PendingPayment),
        ),
      )
      .run();
  }

  async reservePendingReservation(reservation: Reservation): Promise<void> {
    await this.databaseService.db
      .update(reservations)
      .set({
        status: reservation.status,
        reservedAt: reservation.reservedAt,
      })
      .where(
        and(
          eq(reservations.id, reservation.id),
          eq(reservations.status, ReservationStatus.PendingPayment),
        ),
      )
      .run();
  }

  async seatExists(seatId: string): Promise<boolean> {
    const seat = await this.databaseService.db
      .select({ id: seats.id })
      .from(seats)
      .where(eq(seats.id, seatId))
      .get();

    return Boolean(seat);
  }

  async findActiveReservationForSeat(
    seatId: string,
  ): Promise<{ id: string } | null> {
    const reservation = await this.databaseService.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.seatId, seatId),
          inArray(reservations.status, [
            ReservationStatus.PendingPayment,
            ReservationStatus.Reserved,
          ]),
        ),
      )
      .get();

    return reservation ?? null;
  }
}

function toReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    seatId: row.seatId,
    userId: row.userId,
    status: row.status,
    paymentId: row.paymentId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    reservedAt: row.reservedAt ?? undefined,
  };
}

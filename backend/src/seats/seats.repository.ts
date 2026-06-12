import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { reservations, seats } from '../database/schema';
import { ReservationStatus } from '../reservations/reservation.types';

export interface SeatRecord {
  id: string;
  label: string;
  reservationId: string | null;
  reservationStatus: ReservationStatus | null;
}

@Injectable()
export class SeatsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async listSeatRecords(): Promise<SeatRecord[]> {
    return await this.baseSeatQuery().orderBy(seats.id).all();
  }

  async findSeatRecord(seatId: string): Promise<SeatRecord | undefined> {
    return await this.baseSeatQuery().where(eq(seats.id, seatId)).get();
  }

  async holdForReservation(
    seatId: string,
    reservationId: string,
  ): Promise<void> {
    await this.databaseService.db
      .update(reservations)
      .set({ status: ReservationStatus.PendingPayment })
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.seatId, seatId),
          eq(reservations.status, ReservationStatus.PendingPayment),
        ),
      )
      .run();
  }

  async reserveForReservation(
    seatId: string,
    reservationId: string,
  ): Promise<void> {
    await this.databaseService.db
      .update(reservations)
      .set({
        status: ReservationStatus.Reserved,
        reservedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.seatId, seatId),
          eq(reservations.status, ReservationStatus.PendingPayment),
        ),
      )
      .run();
  }

  async releaseForReservation(
    seatId: string,
    reservationId: string,
  ): Promise<void> {
    await this.databaseService.db
      .update(reservations)
      .set({ status: ReservationStatus.Expired })
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.seatId, seatId),
          eq(reservations.status, ReservationStatus.PendingPayment),
        ),
      )
      .run();
  }

  private baseSeatQuery() {
    return this.databaseService.db
      .select({
        id: sql<string>`${seats.id}`.as('seat_id'),
        label: sql<string>`${seats.label}`.as('seat_label'),
        reservationId: sql<string | null>`${reservations.id}`.as(
          'reservation_id',
        ),
        reservationStatus:
          sql<ReservationStatus | null>`${reservations.status}`.as(
            'reservation_status',
          ),
      })
      .from(seats)
      .leftJoin(
        reservations,
        and(
          eq(reservations.seatId, seats.id),
          inArray(reservations.status, [
            ReservationStatus.PendingPayment,
            ReservationStatus.Reserved,
          ]),
        ),
      );
  }
}

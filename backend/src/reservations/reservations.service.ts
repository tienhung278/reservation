import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { User } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { Payment, PaymentStatus } from '../payments/payment.types';
import { PaymentsRepository } from '../payments/payments.repository';
import { Reservation, ReservationStatus } from './reservation.types';
import { ReservationsRepository } from './reservations.repository';

const PENDING_RESERVATION_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly reservationsRepository: ReservationsRepository,
    private readonly paymentsRepository: PaymentsRepository,
  ) {}

  async selectSeat(
    dto: unknown,
    user: User,
  ): Promise<{
    reservation: Reservation;
    payment: Payment;
  }> {
    if (!isRecord(dto)) {
      throw new UnprocessableEntityException('seatId is required');
    }

    if (typeof dto.seatId !== 'string' || dto.seatId.trim() === '') {
      throw new UnprocessableEntityException('seatId is required');
    }

    const seatId = dto.seatId;

    try {
      return await this.databaseService.transaction(async () => {
        await this.expirePendingReservations();
        await this.ensureSeatExists(seatId);

        if (await this.getActiveReservationForSeat(seatId)) {
          throw new ConflictException('Seat is not available');
        }

        const reservationId = randomUUID();
        const paymentId = randomUUID();
        const createdAt = new Date();
        const expiresAt = new Date(
          createdAt.getTime() + PENDING_RESERVATION_TTL_MS,
        );
        const reservation: Reservation = {
          id: reservationId,
          seatId,
          userId: user.id,
          status: ReservationStatus.PendingPayment,
          paymentId,
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        };
        const payment: Payment = {
          id: paymentId,
          reservationId,
          userId: user.id,
          status: PaymentStatus.Pending,
          createdAt: reservation.createdAt,
          expiresAt: reservation.expiresAt,
        };

        await this.reservationsRepository.create(reservation);
        await this.paymentsRepository.create(payment);

        return { reservation, payment };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Seat is not available');
      }

      throw error;
    }
  }

  async getReservation(reservationId: string): Promise<Reservation> {
    const reservation =
      await this.reservationsRepository.findById(reservationId);

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    return reservation;
  }

  async expireReservationForPayment(
    payment: Payment,
    user: User,
  ): Promise<Reservation> {
    return await this.databaseService.transaction(async () => {
      if (payment.userId !== user.id) {
        throw new NotFoundException('Payment not found');
      }

      const reservation = await this.getReservation(payment.reservationId);

      if (reservation.userId !== user.id) {
        throw new NotFoundException('Reservation not found');
      }

      return await this.expireReservation(reservation);
    });
  }

  async expirePendingReservations(now = new Date()): Promise<Reservation[]> {
    return await this.databaseService.transaction(async () => {
      const nowIso = now.toISOString();
      const expiredReservations =
        await this.reservationsRepository.findExpiredPending(nowIso);

      if (expiredReservations.length > 0) {
        await this.reservationsRepository.expirePendingReservations(nowIso);
        await this.paymentsRepository.expirePendingPayments(nowIso);
      }

      return expiredReservations.map((reservation) => ({
        ...reservation,
        status: ReservationStatus.Expired,
      }));
    });
  }

  async completeReservationForPayment(
    payment: Payment,
    user: User,
  ): Promise<Reservation> {
    return await this.databaseService.transaction(async () => {
      if (payment.userId !== user.id) {
        throw new NotFoundException('Payment not found');
      }

      const reservation = await this.getReservation(payment.reservationId);

      if (reservation.userId !== user.id) {
        throw new NotFoundException('Reservation not found');
      }

      if (reservation.status !== ReservationStatus.PendingPayment) {
        throw new ConflictException('Reservation is already completed');
      }

      const activeReservation = await this.getActiveReservationForSeat(
        reservation.seatId,
      );
      if (activeReservation && activeReservation.id !== reservation.id) {
        throw new ConflictException('Seat is not available');
      }

      const completed = {
        ...reservation,
        status: ReservationStatus.Reserved,
        reservedAt: new Date().toISOString(),
      };
      await this.reservationsRepository.reservePendingReservation(completed);

      return completed;
    });
  }

  private async expireReservation(
    reservation: Reservation,
  ): Promise<Reservation> {
    if (reservation.status !== ReservationStatus.PendingPayment) {
      return reservation;
    }

    const expired = {
      ...reservation,
      status: ReservationStatus.Expired,
    };
    await this.reservationsRepository.expirePendingReservation(expired.id);
    await this.paymentsRepository.markPendingExpired(expired.paymentId);

    return expired;
  }

  private async ensureSeatExists(seatId: string): Promise<void> {
    if (!(await this.reservationsRepository.seatExists(seatId))) {
      throw new NotFoundException('Seat not found');
    }
  }

  private async getActiveReservationForSeat(
    seatId: string,
  ): Promise<{ id: string } | null> {
    return await this.reservationsRepository.findActiveReservationForSeat(
      seatId,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  const sqliteError = error as { code?: string; message?: string };

  return (
    error instanceof Error &&
    sqliteError.code === 'ERR_SQLITE_ERROR' &&
    error.message.includes('UNIQUE constraint failed')
  );
}

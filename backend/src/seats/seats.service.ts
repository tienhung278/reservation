import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PaymentsRepository } from '../payments/payments.repository';
import { ReservationStatus } from '../reservations/reservation.types';
import { ReservationsRepository } from '../reservations/reservations.repository';
import { SeatStatus, SeatView } from './seat.types';
import { SeatRecord, SeatsRepository } from './seats.repository';

@Injectable()
export class SeatsService {
  private beforeAccessCleanup?: () => Promise<void> | void;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly seatsRepository: SeatsRepository,
    private readonly reservationsRepository: ReservationsRepository,
    private readonly paymentsRepository: PaymentsRepository,
  ) {}

  registerBeforeAccessCleanup(cleanup: () => Promise<void> | void): void {
    this.beforeAccessCleanup = cleanup;
  }

  async listSeats(): Promise<SeatView[]> {
    await this.runBeforeAccessCleanup();
    const rows = await this.seatsRepository.listSeatRecords();
    return rows.map((seat) => this.toView(seat));
  }

  async getSeat(seatId: string): Promise<SeatView> {
    await this.runBeforeAccessCleanup();
    const seat = await this.getSeatRecord(seatId);
    return this.toView(seat);
  }

  async isAvailable(seatId: string): Promise<boolean> {
    return (await this.getSeat(seatId)).available;
  }

  async holdForReservation(
    seatId: string,
    reservationId: string,
  ): Promise<SeatView> {
    await this.seatsRepository.holdForReservation(seatId, reservationId);

    return await this.getSeat(seatId);
  }

  async reserveForReservation(
    seatId: string,
    reservationId: string,
  ): Promise<SeatView> {
    await this.seatsRepository.reserveForReservation(seatId, reservationId);

    return await this.getSeat(seatId);
  }

  async releaseForReservation(
    seatId: string,
    reservationId: string,
  ): Promise<SeatView> {
    await this.seatsRepository.releaseForReservation(seatId, reservationId);

    return await this.getSeat(seatId);
  }

  private async runBeforeAccessCleanup(): Promise<void> {
    await this.beforeAccessCleanup?.();
    await this.expirePendingReservations();
  }

  private async getSeatRecord(seatId: string): Promise<SeatRecord> {
    const seat = await this.seatsRepository.findSeatRecord(seatId);

    if (!seat) {
      throw new NotFoundException('Seat not found');
    }

    return seat;
  }

  private toView(seat: SeatRecord): SeatView {
    const status = toSeatStatus(seat.reservationStatus);
    const view: SeatView = {
      id: seat.id,
      label: seat.label,
      status,
      available: status === SeatStatus.Available,
    };

    if (seat.reservationId) {
      view.reservationId = seat.reservationId;
    }

    return view;
  }

  private async expirePendingReservations(): Promise<void> {
    await this.databaseService.transaction(async () => {
      const now = new Date().toISOString();

      await this.reservationsRepository.expirePendingReservations(now);
      await this.paymentsRepository.expirePendingPayments(now);
    });
  }
}

function toSeatStatus(status: ReservationStatus | null): SeatStatus {
  if (status === ReservationStatus.PendingPayment) {
    return SeatStatus.Pending;
  }

  if (status === ReservationStatus.Reserved) {
    return SeatStatus.Reserved;
  }

  return SeatStatus.Available;
}

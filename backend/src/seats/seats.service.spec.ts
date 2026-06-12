import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PaymentsRepository } from '../payments/payments.repository';
import { ReservationStatus } from '../reservations/reservation.types';
import { ReservationsRepository } from '../reservations/reservations.repository';
import { SeatStatus } from './seat.types';
import { SeatRecord, SeatsRepository } from './seats.repository';
import { SeatsService } from './seats.service';

describe('SeatsService', () => {
  let databaseService: jest.Mocked<Pick<DatabaseService, 'transaction'>>;
  let seatsRepository: jest.Mocked<
    Pick<
      SeatsRepository,
      | 'listSeatRecords'
      | 'findSeatRecord'
      | 'holdForReservation'
      | 'reserveForReservation'
      | 'releaseForReservation'
    >
  >;
  let reservationsRepository: jest.Mocked<
    Pick<ReservationsRepository, 'expirePendingReservations'>
  >;
  let paymentsRepository: jest.Mocked<
    Pick<PaymentsRepository, 'expirePendingPayments'>
  >;
  let service: SeatsService;

  beforeEach(() => {
    databaseService = {
      transaction: jest.fn(async (operation: () => Promise<unknown>) => {
        return await operation();
      }),
    };
    seatsRepository = {
      listSeatRecords: jest.fn(),
      findSeatRecord: jest.fn(),
      holdForReservation: jest.fn(),
      reserveForReservation: jest.fn(),
      releaseForReservation: jest.fn(),
    };
    reservationsRepository = {
      expirePendingReservations: jest.fn(),
    };
    paymentsRepository = {
      expirePendingPayments: jest.fn(),
    };
    service = new SeatsService(
      databaseService as DatabaseService,
      seatsRepository as unknown as SeatsRepository,
      reservationsRepository as unknown as ReservationsRepository,
      paymentsRepository as unknown as PaymentsRepository,
    );
  });

  it('maps available, pending, and reserved records to seat views', async () => {
    seatsRepository.listSeatRecords.mockResolvedValue([
      seatRecord({
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: null,
        reservationStatus: null,
      }),
      seatRecord({
        id: 'seat-2',
        label: 'Seat 2',
        reservationId: 'reservation-2',
        reservationStatus: ReservationStatus.PendingPayment,
      }),
      seatRecord({
        id: 'seat-3',
        label: 'Seat 3',
        reservationId: 'reservation-3',
        reservationStatus: ReservationStatus.Reserved,
      }),
    ]);

    await expect(service.listSeats()).resolves.toStrictEqual([
      {
        id: 'seat-1',
        label: 'Seat 1',
        status: SeatStatus.Available,
        available: true,
      },
      {
        id: 'seat-2',
        label: 'Seat 2',
        status: SeatStatus.Pending,
        available: false,
        reservationId: 'reservation-2',
      },
      {
        id: 'seat-3',
        label: 'Seat 3',
        status: SeatStatus.Reserved,
        available: false,
        reservationId: 'reservation-3',
      },
    ]);
  });

  it('does not expose a reservation id for available seats', async () => {
    seatsRepository.findSeatRecord.mockResolvedValue(
      seatRecord({
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: null,
        reservationStatus: null,
      }),
    );

    const seat = await service.getSeat('seat-1');

    expect(seat).toMatchObject({
      status: SeatStatus.Available,
      available: true,
    });
    expect(seat).not.toHaveProperty('reservationId');
  });

  it('throws NotFoundException for an unknown seat', async () => {
    seatsRepository.findSeatRecord.mockResolvedValue(undefined);

    await expect(service.getSeat('missing-seat')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('runs registered cleanup before expiry cleanup and reads', async () => {
    const cleanup = jest.fn();
    service.registerBeforeAccessCleanup(cleanup);
    seatsRepository.listSeatRecords.mockResolvedValue([]);

    await service.listSeats();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(databaseService.transaction).toHaveBeenCalledTimes(1);
    expect(reservationsRepository.expirePendingReservations).toHaveBeenCalled();
    expect(paymentsRepository.expirePendingPayments).toHaveBeenCalled();
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      databaseService.transaction.mock.invocationCallOrder[0],
    );
    expect(
      reservationsRepository.expirePendingReservations.mock
        .invocationCallOrder[0],
    ).toBeLessThan(seatsRepository.listSeatRecords.mock.invocationCallOrder[0]);
    expect(
      paymentsRepository.expirePendingPayments.mock.invocationCallOrder[0],
    ).toBeLessThan(seatsRepository.listSeatRecords.mock.invocationCallOrder[0]);
  });

  it('wraps expiry cleanup in a database transaction', async () => {
    let inTransaction = false;
    databaseService.transaction.mockImplementation(
      async (operation: () => Promise<unknown>) => {
        inTransaction = true;
        try {
          return await operation();
        } finally {
          inTransaction = false;
        }
      },
    );
    reservationsRepository.expirePendingReservations.mockImplementation(() => {
      expect(inTransaction).toBe(true);
      return Promise.resolve();
    });
    paymentsRepository.expirePendingPayments.mockImplementation(() => {
      expect(inTransaction).toBe(true);
      return Promise.resolve();
    });
    seatsRepository.findSeatRecord.mockResolvedValue(
      seatRecord({
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: null,
        reservationStatus: null,
      }),
    );

    await service.getSeat('seat-1');

    expect(databaseService.transaction).toHaveBeenCalledTimes(1);
  });

  it('delegates holds to the repository and returns a fresh seat view', async () => {
    seatsRepository.findSeatRecord.mockResolvedValue(
      seatRecord({
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: 'reservation-1',
        reservationStatus: ReservationStatus.PendingPayment,
      }),
    );

    await expect(
      service.holdForReservation('seat-1', 'reservation-1'),
    ).resolves.toMatchObject({
      id: 'seat-1',
      status: SeatStatus.Pending,
      reservationId: 'reservation-1',
    });
    expect(seatsRepository.holdForReservation).toHaveBeenCalledWith(
      'seat-1',
      'reservation-1',
    );
    expect(seatsRepository.findSeatRecord).toHaveBeenCalledWith('seat-1');
  });

  it('delegates reservations to the repository and returns a fresh seat view', async () => {
    seatsRepository.findSeatRecord.mockResolvedValue(
      seatRecord({
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: 'reservation-1',
        reservationStatus: ReservationStatus.Reserved,
      }),
    );

    await expect(
      service.reserveForReservation('seat-1', 'reservation-1'),
    ).resolves.toMatchObject({
      id: 'seat-1',
      status: SeatStatus.Reserved,
      reservationId: 'reservation-1',
    });
    expect(seatsRepository.reserveForReservation).toHaveBeenCalledWith(
      'seat-1',
      'reservation-1',
    );
    expect(seatsRepository.findSeatRecord).toHaveBeenCalledWith('seat-1');
  });

  it('delegates releases to the repository and returns a fresh seat view', async () => {
    seatsRepository.findSeatRecord.mockResolvedValue(
      seatRecord({
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: null,
        reservationStatus: null,
      }),
    );

    await expect(
      service.releaseForReservation('seat-1', 'reservation-1'),
    ).resolves.toMatchObject({
      id: 'seat-1',
      status: SeatStatus.Available,
      available: true,
    });
    expect(seatsRepository.releaseForReservation).toHaveBeenCalledWith(
      'seat-1',
      'reservation-1',
    );
    expect(seatsRepository.findSeatRecord).toHaveBeenCalledWith('seat-1');
  });

  function seatRecord(record: SeatRecord): SeatRecord {
    return record;
  }
});

import { DatabaseService } from '../database/database.service';
import { ReservationStatus } from '../reservations/reservation.types';
import { SeatsRepository } from './seats.repository';

describe('SeatsRepository', () => {
  let databaseService: DatabaseService;
  let repository: SeatsRepository;

  beforeEach(() => {
    databaseService = new DatabaseService();
    repository = new SeatsRepository(databaseService);
  });

  afterEach(() => {
    databaseService.close();
  });

  it('lists seeded seats in stable id order with null reservation fields', async () => {
    await expect(repository.listSeatRecords()).resolves.toEqual([
      {
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: null,
        reservationStatus: null,
      },
      {
        id: 'seat-2',
        label: 'Seat 2',
        reservationId: null,
        reservationStatus: null,
      },
      {
        id: 'seat-3',
        label: 'Seat 3',
        reservationId: null,
        reservationStatus: null,
      },
    ]);
  });

  it('finds an available seat with null reservation fields', async () => {
    await expect(repository.findSeatRecord('seat-1')).resolves.toEqual({
      id: 'seat-1',
      label: 'Seat 1',
      reservationId: null,
      reservationStatus: null,
    });
    await expect(
      repository.findSeatRecord('missing-seat'),
    ).resolves.toBeUndefined();
  });

  it('joins only pending and reserved reservations and ignores expired ones', async () => {
    seedReservation({
      id: 'pending-reservation',
      seatId: 'seat-1',
      status: ReservationStatus.PendingPayment,
    });
    seedReservation({
      id: 'reserved-reservation',
      seatId: 'seat-2',
      status: ReservationStatus.Reserved,
      reservedAt: '2026-01-01T00:30:00.000Z',
    });
    seedReservation({
      id: 'expired-reservation',
      seatId: 'seat-3',
      status: ReservationStatus.Expired,
    });

    await expect(repository.listSeatRecords()).resolves.toEqual([
      {
        id: 'seat-1',
        label: 'Seat 1',
        reservationId: 'pending-reservation',
        reservationStatus: ReservationStatus.PendingPayment,
      },
      {
        id: 'seat-2',
        label: 'Seat 2',
        reservationId: 'reserved-reservation',
        reservationStatus: ReservationStatus.Reserved,
      },
      {
        id: 'seat-3',
        label: 'Seat 3',
        reservationId: null,
        reservationStatus: null,
      },
    ]);
  });

  it('holds only matching pending reservations', async () => {
    seedReservation({
      id: 'pending-reservation',
      seatId: 'seat-1',
      status: ReservationStatus.PendingPayment,
    });
    seedReservation({
      id: 'reserved-reservation',
      seatId: 'seat-2',
      status: ReservationStatus.Reserved,
      reservedAt: '2026-01-01T00:30:00.000Z',
    });
    seedReservation({
      id: 'expired-reservation',
      seatId: 'seat-3',
      status: ReservationStatus.Expired,
    });

    await repository.holdForReservation('wrong-seat', 'pending-reservation');
    await repository.holdForReservation('seat-2', 'reserved-reservation');
    await repository.holdForReservation('seat-3', 'expired-reservation');
    resetChangeCount();
    await repository.holdForReservation('seat-1', 'pending-reservation');

    expect(getChangeCount()).toBe(1);
    expect(getReservationStatus('pending-reservation')).toBe(
      ReservationStatus.PendingPayment,
    );
    expect(getReservationStatus('reserved-reservation')).toBe(
      ReservationStatus.Reserved,
    );
    expect(getReservationStatus('expired-reservation')).toBe(
      ReservationStatus.Expired,
    );
  });

  it('reserves only matching pending reservations', async () => {
    seedReservation({
      id: 'pending-reservation',
      seatId: 'seat-1',
      status: ReservationStatus.PendingPayment,
    });
    seedReservation({
      id: 'reserved-reservation',
      seatId: 'seat-2',
      status: ReservationStatus.Reserved,
      reservedAt: '2026-01-01T00:30:00.000Z',
    });
    seedReservation({
      id: 'expired-reservation',
      seatId: 'seat-3',
      status: ReservationStatus.Expired,
    });

    await repository.reserveForReservation('wrong-seat', 'pending-reservation');
    expect(getReservationStatus('pending-reservation')).toBe(
      ReservationStatus.PendingPayment,
    );

    await repository.reserveForReservation('seat-2', 'reserved-reservation');
    await repository.reserveForReservation('seat-3', 'expired-reservation');
    await repository.reserveForReservation('seat-1', 'pending-reservation');

    expect(getReservationStatus('pending-reservation')).toBe(
      ReservationStatus.Reserved,
    );
    expect(getReservedAt('pending-reservation')).toEqual(expect.any(String));
    expect(getReservationStatus('reserved-reservation')).toBe(
      ReservationStatus.Reserved,
    );
    expect(getReservedAt('reserved-reservation')).toBe(
      '2026-01-01T00:30:00.000Z',
    );
    expect(getReservationStatus('expired-reservation')).toBe(
      ReservationStatus.Expired,
    );
    expect(getReservedAt('expired-reservation')).toBeNull();
  });

  it('releases only matching pending reservations', async () => {
    seedReservation({
      id: 'pending-reservation',
      seatId: 'seat-1',
      status: ReservationStatus.PendingPayment,
    });
    seedReservation({
      id: 'reserved-reservation',
      seatId: 'seat-2',
      status: ReservationStatus.Reserved,
      reservedAt: '2026-01-01T00:30:00.000Z',
    });
    seedReservation({
      id: 'expired-reservation',
      seatId: 'seat-3',
      status: ReservationStatus.Expired,
    });

    await repository.releaseForReservation('wrong-seat', 'pending-reservation');
    expect(getReservationStatus('pending-reservation')).toBe(
      ReservationStatus.PendingPayment,
    );

    await repository.releaseForReservation('seat-2', 'reserved-reservation');
    await repository.releaseForReservation('seat-3', 'expired-reservation');
    await repository.releaseForReservation('seat-1', 'pending-reservation');

    expect(getReservationStatus('pending-reservation')).toBe(
      ReservationStatus.Expired,
    );
    expect(getReservationStatus('reserved-reservation')).toBe(
      ReservationStatus.Reserved,
    );
    expect(getReservationStatus('expired-reservation')).toBe(
      ReservationStatus.Expired,
    );
  });

  function seedReservation(input: {
    id: string;
    seatId: string;
    status: ReservationStatus;
    reservedAt?: string;
  }): void {
    databaseService.connection
      .prepare(
        `
          INSERT INTO reservations (
            id,
            seat_id,
            user_id,
            status,
            payment_id,
            created_at,
            expires_at,
            reserved_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.seatId,
        'user-1',
        input.status,
        `${input.id}-payment`,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T01:00:00.000Z',
        input.reservedAt ?? null,
      );
  }

  function getReservationStatus(id: string): ReservationStatus {
    return getReservation(id).status;
  }

  function getReservedAt(id: string): string | null {
    return getReservation(id).reserved_at;
  }

  function resetChangeCount(): void {
    databaseService.connection
      .prepare("UPDATE reservations SET status = status WHERE id = '__none__'")
      .run();
  }

  function getChangeCount(): number {
    return (
      databaseService.connection.prepare('SELECT changes() AS count').get() as {
        count: number;
      }
    ).count;
  }

  function getReservation(id: string): {
    status: ReservationStatus;
    reserved_at: string | null;
  } {
    return databaseService.connection
      .prepare('SELECT status, reserved_at FROM reservations WHERE id = ?')
      .get(id) as {
      status: ReservationStatus;
      reserved_at: string | null;
    };
  }
});

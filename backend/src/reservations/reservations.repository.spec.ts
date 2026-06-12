import { DatabaseService } from '../database/database.service';
import { Reservation, ReservationStatus } from './reservation.types';
import { ReservationsRepository } from './reservations.repository';

describe('ReservationsRepository', () => {
  let databaseService: DatabaseService;
  let repository: ReservationsRepository;

  beforeEach(() => {
    databaseService = new DatabaseService();
    repository = new ReservationsRepository(databaseService);
  });

  afterEach(() => {
    databaseService.close();
  });

  it('creates and finds reservations, mapping nullable reservedAt to undefined', async () => {
    const reservation = makeReservation({ id: 'reservation-1' });

    await repository.create(reservation);

    await expect(repository.findById(reservation.id)).resolves.toEqual(
      reservation,
    );
    await expect(
      repository.findById('missing-reservation'),
    ).resolves.toBeUndefined();
  });

  it('checks whether a seat exists', async () => {
    await expect(repository.seatExists('seat-1')).resolves.toBe(true);
    await expect(repository.seatExists('missing-seat')).resolves.toBe(false);
  });

  it('finds active reservations for a seat and ignores expired reservations', async () => {
    await repository.create(
      makeReservation({
        id: 'pending-reservation',
        seatId: 'seat-1',
        status: ReservationStatus.PendingPayment,
      }),
    );
    await repository.create(
      makeReservation({
        id: 'reserved-reservation',
        seatId: 'seat-2',
        status: ReservationStatus.Reserved,
        reservedAt: '2026-01-01T00:30:00.000Z',
      }),
    );
    await repository.create(
      makeReservation({
        id: 'expired-reservation',
        seatId: 'seat-3',
        status: ReservationStatus.Expired,
      }),
    );

    await expect(
      repository.findActiveReservationForSeat('seat-1'),
    ).resolves.toEqual({ id: 'pending-reservation' });
    await expect(
      repository.findActiveReservationForSeat('seat-2'),
    ).resolves.toEqual({ id: 'reserved-reservation' });
    await expect(
      repository.findActiveReservationForSeat('seat-3'),
    ).resolves.toBeNull();
  });

  it('finds and expires only pending reservations at or before the timestamp', async () => {
    seedSeat('seat-4', 'Seat 4');
    seedSeat('seat-5', 'Seat 5');

    await repository.create(
      makeReservation({
        id: 'pending-before',
        seatId: 'seat-1',
        expiresAt: '2026-01-01T00:59:59.999Z',
      }),
    );
    await repository.create(
      makeReservation({
        id: 'pending-at',
        seatId: 'seat-2',
        expiresAt: '2026-01-01T01:00:00.000Z',
      }),
    );
    await repository.create(
      makeReservation({
        id: 'pending-after',
        seatId: 'seat-3',
        expiresAt: '2026-01-01T01:00:00.001Z',
      }),
    );
    await repository.create(
      makeReservation({
        id: 'reserved-before',
        seatId: 'seat-4',
        status: ReservationStatus.Reserved,
        expiresAt: '2026-01-01T00:59:59.999Z',
        reservedAt: '2026-01-01T00:30:00.000Z',
      }),
    );
    await repository.create(
      makeReservation({
        id: 'expired-before',
        seatId: 'seat-5',
        status: ReservationStatus.Expired,
        expiresAt: '2026-01-01T00:59:59.999Z',
      }),
    );

    const expiredPending = await repository.findExpiredPending(
      '2026-01-01T01:00:00.000Z',
    );

    expect(expiredPending.map((reservation) => reservation.id).sort()).toEqual([
      'pending-at',
      'pending-before',
    ]);

    await repository.expirePendingReservations('2026-01-01T01:00:00.000Z');

    await expect(repository.findById('pending-before')).resolves.toMatchObject({
      status: ReservationStatus.Expired,
    });
    await expect(repository.findById('pending-at')).resolves.toMatchObject({
      status: ReservationStatus.Expired,
    });
    await expect(repository.findById('pending-after')).resolves.toMatchObject({
      status: ReservationStatus.PendingPayment,
    });
    await expect(repository.findById('reserved-before')).resolves.toMatchObject(
      {
        status: ReservationStatus.Reserved,
      },
    );
    await expect(repository.findById('expired-before')).resolves.toMatchObject({
      status: ReservationStatus.Expired,
    });
  });

  it('expires and reserves only pending reservations by id', async () => {
    seedSeat('seat-4', 'Seat 4');

    await repository.create(
      makeReservation({
        id: 'pending-reservation',
        seatId: 'seat-1',
      }),
    );
    await repository.create(
      makeReservation({
        id: 'expired-reservation',
        seatId: 'seat-2',
        status: ReservationStatus.Expired,
      }),
    );
    await repository.create(
      makeReservation({
        id: 'reserved-reservation',
        seatId: 'seat-3',
        status: ReservationStatus.Reserved,
        reservedAt: '2026-01-01T00:20:00.000Z',
      }),
    );

    await repository.reservePendingReservation(
      makeReservation({
        id: 'pending-reservation',
        seatId: 'seat-1',
        status: ReservationStatus.Reserved,
        reservedAt: '2026-01-01T00:30:00.000Z',
      }),
    );
    await repository.reservePendingReservation(
      makeReservation({
        id: 'expired-reservation',
        seatId: 'seat-2',
        status: ReservationStatus.Reserved,
        reservedAt: '2026-01-01T00:30:00.000Z',
      }),
    );

    await expect(
      repository.findById('pending-reservation'),
    ).resolves.toMatchObject({
      status: ReservationStatus.Reserved,
      reservedAt: '2026-01-01T00:30:00.000Z',
    });
    await expect(
      repository.findById('expired-reservation'),
    ).resolves.toMatchObject({
      status: ReservationStatus.Expired,
      reservedAt: undefined,
    });

    await repository.create(
      makeReservation({
        id: 'pending-to-expire',
        seatId: 'seat-4',
      }),
    );
    await repository.expirePendingReservation('pending-to-expire');
    await repository.expirePendingReservation('reserved-reservation');

    await expect(
      repository.findById('pending-to-expire'),
    ).resolves.toMatchObject({
      status: ReservationStatus.Expired,
    });
    await expect(
      repository.findById('reserved-reservation'),
    ).resolves.toMatchObject({
      status: ReservationStatus.Reserved,
      reservedAt: '2026-01-01T00:20:00.000Z',
    });
  });

  it('requires seats to exist and enforces one active reservation per seat', async () => {
    await expect(
      repository.create(
        makeReservation({
          id: 'missing-seat-reservation',
          seatId: 'missing-seat',
        }),
      ),
    ).rejects.toThrow();

    await repository.create(
      makeReservation({
        id: 'active-reservation',
        seatId: 'seat-1',
      }),
    );

    await expect(
      repository.create(
        makeReservation({
          id: 'duplicate-active-reservation',
          seatId: 'seat-1',
        }),
      ),
    ).rejects.toThrow();

    await expect(
      repository.create(
        makeReservation({
          id: 'expired-same-seat-reservation',
          seatId: 'seat-1',
          status: ReservationStatus.Expired,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
    return {
      id: 'reservation-1',
      seatId: 'seat-1',
      userId: 'user-1',
      status: ReservationStatus.PendingPayment,
      paymentId: 'payment-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T01:00:00.000Z',
      ...overrides,
    };
  }

  function seedSeat(id: string, label: string): void {
    databaseService.connection
      .prepare('INSERT INTO seats (id, label) VALUES (?, ?)')
      .run(id, label);
  }
});

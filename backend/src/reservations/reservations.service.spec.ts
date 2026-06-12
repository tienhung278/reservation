import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PaymentStatus } from '../payments/payment.types';
import { PaymentsRepository } from '../payments/payments.repository';
import { PaymentsService } from '../payments/payments.service';
import { SeatStatus } from '../seats/seat.types';
import { SeatsRepository } from '../seats/seats.repository';
import { SeatsService } from '../seats/seats.service';
import { ReservationStatus } from './reservation.types';
import { ReservationsRepository } from './reservations.repository';
import { ReservationsService } from './reservations.service';

describe('ReservationsService', () => {
  const user = { id: 'demo-user', username: 'demo@example.com' };
  let databaseService: DatabaseService;
  let seatsService: SeatsService;
  let paymentsService: PaymentsService;
  let reservationsService: ReservationsService;

  beforeEach(() => {
    databaseService = new DatabaseService();
    const paymentsRepository = new PaymentsRepository(databaseService);
    const reservationsRepository = new ReservationsRepository(databaseService);

    seatsService = new SeatsService(
      databaseService,
      new SeatsRepository(databaseService),
      reservationsRepository,
      paymentsRepository,
    );
    paymentsService = new PaymentsService(databaseService, paymentsRepository);
    reservationsService = new ReservationsService(
      databaseService,
      reservationsRepository,
      paymentsRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    databaseService.close();
  });

  it('holds a seat while payment is pending and reserves it after payment', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const selected = await reservationsService.selectSeat(
      { seatId: 'seat-1' },
      user,
    );

    expect(selected.reservation.status).toBe(ReservationStatus.PendingPayment);
    expect(selected.reservation.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(selected.reservation.expiresAt).toBe('2026-01-01T01:00:00.000Z');
    expect(selected.payment.status).toBe(PaymentStatus.Pending);
    expect(selected.payment.expiresAt).toBe(selected.reservation.expiresAt);
    expect((await seatsService.getSeat('seat-1')).status).toBe(
      SeatStatus.Pending,
    );
    await expect(
      reservationsService.selectSeat({ seatId: 'seat-1' }, user),
    ).rejects.toThrow(ConflictException);

    const completed = await paymentsService.completePayment(
      selected.payment.id,
      user.id,
      (payment) =>
        reservationsService.completeReservationForPayment(payment, user),
    );

    expect(completed.payment.status).toBe(PaymentStatus.Succeeded);
    expect(completed.finalized.status).toBe(ReservationStatus.Reserved);
    expect((await seatsService.getSeat('seat-1')).status).toBe(
      SeatStatus.Reserved,
    );
  });

  it.each([undefined, null, {}, { seatId: '' }, { seatId: 123 }])(
    'rejects invalid seat selection DTO %p',
    async (dto) => {
      await expect(reservationsService.selectSeat(dto, user)).rejects.toThrow(
        UnprocessableEntityException,
      );
    },
  );

  it('throws NotFoundException when selecting a missing seat', async () => {
    await expect(
      reservationsService.selectSeat({ seatId: 'missing-seat' }, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for an unknown reservation', async () => {
    await expect(
      reservationsService.getReservation('missing-reservation'),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not complete reservations through another user path', async () => {
    const otherUser = { id: 'other-user', username: 'other@example.com' };
    const selected = await reservationsService.selectSeat(
      { seatId: 'seat-1' },
      user,
    );

    await expect(
      reservationsService.completeReservationForPayment(
        selected.payment,
        otherUser,
      ),
    ).rejects.toThrow('Payment not found');
    await expect(
      reservationsService.completeReservationForPayment(
        { ...selected.payment, userId: otherUser.id },
        otherUser,
      ),
    ).rejects.toThrow('Reservation not found');
  });

  it('rejects duplicate selection atomically without orphan payments', async () => {
    await reservationsService.selectSeat({ seatId: 'seat-1' }, user);

    await expect(
      reservationsService.selectSeat({ seatId: 'seat-1' }, user),
    ).rejects.toThrow(ConflictException);
    expect(countRows('reservations')).toBe(1);
    expect(countRows('payments')).toBe(1);
    expect(
      (
        databaseService.connection
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM payments
              WHERE reservation_id NOT IN (
                SELECT id FROM reservations
              )
            `,
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

  it('lazily expires pending reservations before seat reads', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const selected = await reservationsService.selectSeat(
      { seatId: 'seat-1' },
      user,
    );

    jest.setSystemTime(new Date(selected.reservation.expiresAt));

    await expect(seatsService.getSeat('seat-1')).resolves.toMatchObject({
      available: true,
      status: SeatStatus.Available,
    });
    expect(
      (await reservationsService.getReservation(selected.reservation.id))
        .status,
    ).toBe(ReservationStatus.Expired);
    expect((await paymentsService.getPayment(selected.payment.id)).status).toBe(
      PaymentStatus.Expired,
    );
  });

  it('lazily expires pending reservations before selecting seats', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const first = await reservationsService.selectSeat(
      { seatId: 'seat-1' },
      user,
    );

    jest.setSystemTime(new Date(first.reservation.expiresAt));

    const second = await reservationsService.selectSeat(
      { seatId: 'seat-1' },
      user,
    );

    expect(
      (await reservationsService.getReservation(first.reservation.id)).status,
    ).toBe(ReservationStatus.Expired);
    expect(second.reservation.status).toBe(ReservationStatus.PendingPayment);
    expect(second.reservation.id).not.toBe(first.reservation.id);
    await expect(seatsService.getSeat('seat-1')).resolves.toMatchObject({
      available: false,
      status: SeatStatus.Pending,
      reservationId: second.reservation.id,
    });
  });

  it('expires and releases the reservation when payment completion is expired', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const selected = await reservationsService.selectSeat(
      { seatId: 'seat-1' },
      user,
    );
    const finalize = jest.fn();

    jest.setSystemTime(new Date(selected.payment.expiresAt));

    await expect(
      paymentsService.completePayment(
        selected.payment.id,
        user.id,
        finalize,
        (payment) =>
          reservationsService.expireReservationForPayment(payment, user),
      ),
    ).rejects.toThrow('Payment has expired');

    expect(finalize).not.toHaveBeenCalled();
    expect((await paymentsService.getPayment(selected.payment.id)).status).toBe(
      PaymentStatus.Expired,
    );
    expect(
      (await reservationsService.getReservation(selected.reservation.id))
        .status,
    ).toBe(ReservationStatus.Expired);
    expect((await seatsService.getSeat('seat-1')).available).toBe(true);

    await expect(
      paymentsService.completePayment(
        selected.payment.id,
        user.id,
        finalize,
        (payment) =>
          reservationsService.expireReservationForPayment(payment, user),
      ),
    ).rejects.toThrow('Payment has expired');
  });

  it('releases only matching pending holds for a reservation', async () => {
    const selected = await reservationsService.selectSeat(
      { seatId: 'seat-1' },
      user,
    );

    await seatsService.releaseForReservation('seat-1', 'reservation-2');

    await expect(seatsService.getSeat('seat-1')).resolves.toMatchObject({
      available: false,
      status: SeatStatus.Pending,
      reservationId: selected.reservation.id,
    });

    await seatsService.reserveForReservation('seat-1', selected.reservation.id);
    await seatsService.releaseForReservation('seat-1', selected.reservation.id);

    await expect(seatsService.getSeat('seat-1')).resolves.toMatchObject({
      available: false,
      status: SeatStatus.Reserved,
      reservationId: selected.reservation.id,
    });
  });

  function countRows(table: 'payments' | 'reservations'): number {
    return (
      databaseService.connection
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number }
    ).count;
  }
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ReservationStatus } from '../reservations/reservation.types';
import { PaymentStatus } from './payment.types';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let databaseService: DatabaseService;
  let service: PaymentsService;

  beforeEach(() => {
    databaseService = new DatabaseService();
    service = new PaymentsService(
      databaseService,
      new PaymentsRepository(databaseService),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    databaseService.close();
  });

  it('sets pending payment expiry one hour after creation', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    const payment = await service.createPendingPayment({
      reservationId: 'reservation-1',
      userId: 'demo-user',
      createdAt,
    });

    expect(payment.status).toBe(PaymentStatus.Pending);
    expect(payment.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(payment.expiresAt).toBe('2026-01-01T01:00:00.000Z');
  });

  it('throws NotFoundException for an unknown payment', async () => {
    await expect(service.getPayment('missing-payment')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('does not complete an unknown payment', async () => {
    const finalize = jest.fn();

    await expect(
      service.completePayment('missing-payment', 'demo-user', finalize),
    ).rejects.toThrow(NotFoundException);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('does not expose payments to another user', async () => {
    const payment = await service.createPendingPayment({
      reservationId: 'reservation-1',
      userId: 'demo-user',
    });
    const finalize = jest.fn();

    await expect(
      service.completePayment(payment.id, 'other-user', finalize),
    ).rejects.toThrow(NotFoundException);
    expect(finalize).not.toHaveBeenCalled();
    expect((await service.getPayment(payment.id)).status).toBe(
      PaymentStatus.Pending,
    );
  });

  it('persists success only after finalization succeeds', async () => {
    const payment = await service.createPendingPayment({
      reservationId: 'reservation-1',
      userId: 'demo-user',
    });

    await expect(
      service.completePayment(payment.id, 'demo-user', () => {
        throw new ConflictException('Reservation cannot be completed');
      }),
    ).rejects.toThrow(ConflictException);

    expect((await service.getPayment(payment.id)).status).toBe(
      PaymentStatus.Pending,
    );

    const completed = await service.completePayment(
      payment.id,
      'demo-user',
      () => ({
        id: 'reservation-1',
        status: ReservationStatus.Reserved,
      }),
    );

    expect(completed.payment.status).toBe(PaymentStatus.Succeeded);
    expect((await service.getPayment(payment.id)).status).toBe(
      PaymentStatus.Succeeded,
    );
    expect(completed.finalized).toEqual({
      id: 'reservation-1',
      status: ReservationStatus.Reserved,
    });
  });

  it('expires pending payments at the expiry timestamp without finalizing', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const payment = await service.createPendingPayment({
      reservationId: 'reservation-1',
      userId: 'demo-user',
    });
    const finalize = jest.fn();
    const expire = jest.fn();

    jest.setSystemTime(new Date(payment.expiresAt));

    await expect(
      service.completePayment(payment.id, 'demo-user', finalize, expire),
    ).rejects.toThrow('Payment has expired');
    expect(finalize).not.toHaveBeenCalled();
    expect(expire).toHaveBeenCalledWith(
      expect.objectContaining({
        id: payment.id,
        status: PaymentStatus.Expired,
      }),
    );
    expect((await service.getPayment(payment.id)).status).toBe(
      PaymentStatus.Expired,
    );

    expire.mockClear();
    await expect(
      service.completePayment(payment.id, 'demo-user', finalize, expire),
    ).rejects.toThrow('Payment has expired');
    expect(finalize).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  it('keeps already completed payments on the existing conflict path', async () => {
    const payment = await service.createPendingPayment({
      reservationId: 'reservation-1',
      userId: 'demo-user',
    });

    await service.completePayment(payment.id, 'demo-user', () => ({
      id: 'reservation-1',
      status: ReservationStatus.Reserved,
    }));

    await expect(
      service.completePayment(payment.id, 'demo-user', () => ({
        id: 'reservation-1',
        status: ReservationStatus.Reserved,
      })),
    ).rejects.toThrow('Payment is already completed');
  });
});

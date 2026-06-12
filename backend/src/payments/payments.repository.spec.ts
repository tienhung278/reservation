import { DatabaseService } from '../database/database.service';
import { Payment, PaymentStatus } from './payment.types';
import { PaymentsRepository } from './payments.repository';

describe('PaymentsRepository', () => {
  let databaseService: DatabaseService;
  let repository: PaymentsRepository;

  beforeEach(() => {
    databaseService = new DatabaseService();
    repository = new PaymentsRepository(databaseService);
  });

  afterEach(() => {
    databaseService.close();
  });

  it('creates and finds payments, mapping nullable completedAt to undefined', async () => {
    const payment = makePayment({ id: 'payment-1' });

    await repository.create(payment);

    await expect(repository.findById(payment.id)).resolves.toEqual(payment);
    await expect(
      repository.findById('missing-payment'),
    ).resolves.toBeUndefined();
  });

  it('marks only pending payments as succeeded', async () => {
    await repository.create(makePayment({ id: 'pending-payment' }));
    await repository.create(
      makePayment({
        id: 'expired-payment',
        status: PaymentStatus.Expired,
      }),
    );

    await repository.markSucceeded(
      makePayment({
        id: 'pending-payment',
        status: PaymentStatus.Succeeded,
        completedAt: '2026-01-01T00:30:00.000Z',
      }),
    );
    await repository.markSucceeded(
      makePayment({
        id: 'expired-payment',
        status: PaymentStatus.Succeeded,
        completedAt: '2026-01-01T00:30:00.000Z',
      }),
    );

    await expect(repository.findById('pending-payment')).resolves.toMatchObject(
      {
        status: PaymentStatus.Succeeded,
        completedAt: '2026-01-01T00:30:00.000Z',
      },
    );
    await expect(repository.findById('expired-payment')).resolves.toMatchObject(
      {
        status: PaymentStatus.Expired,
        completedAt: undefined,
      },
    );
  });

  it('marks payments as expired by id regardless of current status', async () => {
    await repository.create(makePayment({ id: 'pending-payment' }));
    await repository.create(
      makePayment({
        id: 'succeeded-payment',
        status: PaymentStatus.Succeeded,
        completedAt: '2026-01-01T00:30:00.000Z',
      }),
    );

    await repository.markExpired('pending-payment');
    await repository.markExpired('succeeded-payment');

    await expect(repository.findById('pending-payment')).resolves.toMatchObject(
      {
        status: PaymentStatus.Expired,
        completedAt: undefined,
      },
    );
    await expect(
      repository.findById('succeeded-payment'),
    ).resolves.toMatchObject({
      status: PaymentStatus.Expired,
      completedAt: '2026-01-01T00:30:00.000Z',
    });
  });

  it('marks only pending payments as expired by id', async () => {
    await repository.create(makePayment({ id: 'pending-payment' }));
    await repository.create(
      makePayment({
        id: 'succeeded-payment',
        status: PaymentStatus.Succeeded,
        completedAt: '2026-01-01T00:30:00.000Z',
      }),
    );

    await repository.markPendingExpired('pending-payment');
    await repository.markPendingExpired('succeeded-payment');

    await expect(repository.findById('pending-payment')).resolves.toMatchObject(
      {
        status: PaymentStatus.Expired,
      },
    );
    await expect(
      repository.findById('succeeded-payment'),
    ).resolves.toMatchObject({
      status: PaymentStatus.Succeeded,
      completedAt: '2026-01-01T00:30:00.000Z',
    });
  });

  it('expires only pending payments at or before the timestamp', async () => {
    await repository.create(
      makePayment({
        id: 'pending-before',
        expiresAt: '2026-01-01T00:59:59.999Z',
      }),
    );
    await repository.create(
      makePayment({
        id: 'pending-at',
        expiresAt: '2026-01-01T01:00:00.000Z',
      }),
    );
    await repository.create(
      makePayment({
        id: 'pending-after',
        expiresAt: '2026-01-01T01:00:00.001Z',
      }),
    );
    await repository.create(
      makePayment({
        id: 'succeeded-before',
        status: PaymentStatus.Succeeded,
        expiresAt: '2026-01-01T00:59:59.999Z',
        completedAt: '2026-01-01T00:30:00.000Z',
      }),
    );
    await repository.create(
      makePayment({
        id: 'expired-before',
        status: PaymentStatus.Expired,
        expiresAt: '2026-01-01T00:59:59.999Z',
      }),
    );

    await repository.expirePendingPayments('2026-01-01T01:00:00.000Z');

    await expect(repository.findById('pending-before')).resolves.toMatchObject({
      status: PaymentStatus.Expired,
    });
    await expect(repository.findById('pending-at')).resolves.toMatchObject({
      status: PaymentStatus.Expired,
    });
    await expect(repository.findById('pending-after')).resolves.toMatchObject({
      status: PaymentStatus.Pending,
    });
    await expect(
      repository.findById('succeeded-before'),
    ).resolves.toMatchObject({
      status: PaymentStatus.Succeeded,
    });
    await expect(repository.findById('expired-before')).resolves.toMatchObject({
      status: PaymentStatus.Expired,
    });
  });

  function makePayment(overrides: Partial<Payment> = {}): Payment {
    return {
      id: 'payment-1',
      reservationId: 'reservation-1',
      userId: 'user-1',
      status: PaymentStatus.Pending,
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T01:00:00.000Z',
      ...overrides,
    };
  }
});

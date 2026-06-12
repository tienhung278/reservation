import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppStatus } from './../src/app.controller';
import { AppModule } from './../src/app.module';
import { DatabaseService } from './../src/database/database.service';
import { PaymentStatus } from './../src/payments/payment.types';
import { ReservationStatus } from './../src/reservations/reservation.types';
import { SeatStatus } from './../src/seats/seat.types';
import { useRequestBodyParsers } from './../src/shared/body-parser';

interface SeatResponse {
  seats: Array<{
    id: string;
    label: string;
    status: SeatStatus;
    available: boolean;
    reservationId?: string;
  }>;
}

interface SingleSeatResponse {
  seat: {
    id: string;
    label: string;
    status: SeatStatus;
    available: boolean;
    reservationId?: string;
  };
}

interface LoginResponse {
  user: {
    id: string;
    username: string;
  };
  expiresAt: string;
}

interface SelectionResponse {
  reservation: {
    id: string;
    seatId: string;
    status: ReservationStatus;
    paymentId: string;
    createdAt: string;
    expiresAt: string;
  };
  payment: {
    id: string;
    status: PaymentStatus;
    createdAt: string;
    expiresAt: string;
  };
}

interface SessionResponse {
  authenticated: boolean;
  user?: {
    id: string;
    username: string;
  };
}

interface CompletionResponse {
  reservation: {
    seatId: string;
    status: ReservationStatus;
  };
  payment: {
    id: string;
    status: PaymentStatus;
  };
}

interface ErrorResponse {
  message: string;
}

describe('reservation flow (e2e)', () => {
  let app: INestApplication<App>;
  let databaseService: DatabaseService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    databaseService = moduleFixture.get(DatabaseService);
    app = moduleFixture.createNestApplication({ bodyParser: false });
    useRequestBodyParsers(app);
    await app.init();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  it('serves API metadata and exactly three public seats', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('content-type', /application\/json/)
      .expect((response) => {
        expect(response.body).toEqual({
          service: 'seat-reservation-service',
          status: AppStatus.Ok,
          endpoints: [
            'GET /',
            'GET /api/seats',
            'POST /api/auth/login',
            'GET /api/auth/session',
            'POST /api/auth/logout',
            'POST /api/reservations/select',
            'POST /api/payments/:paymentId/complete',
          ],
        });
      });

    await request(app.getHttpServer())
      .get('/api/seats')
      .expect(200)
      .expect((response) => {
        const body = response.body as SeatResponse;
        expect(body.seats).toHaveLength(3);
        expect(body.seats.map((seat) => seat.id)).toEqual([
          'seat-1',
          'seat-2',
          'seat-3',
        ]);
        expect(body.seats.every((seat) => seat.available)).toBe(true);
      });
  });

  it('logs in, selects a seat, completes payment, and reserves the seat', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .get('/api/auth/session')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({ authenticated: false });
      });

    const loginResponse = await agent
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201)
      .expect('set-cookie', /reservation_session=/)
      .expect('set-cookie', /Max-Age=7776000/)
      .expect('set-cookie', /HttpOnly/);

    expect(loginResponse.body).toMatchObject({
      user: { id: 'demo-user', username: 'demo@example.com' },
    });

    await agent
      .get('/api/auth/session')
      .expect(200)
      .expect((response) => {
        const body = response.body as SessionResponse;
        expect(body.authenticated).toBe(true);
        expect(body.user?.username).toBe('demo@example.com');
      });

    const selection = await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-1' })
      .expect(201);
    const selectionBody = selection.body as SelectionResponse;

    expect(selectionBody.reservation).toMatchObject({
      seatId: 'seat-1',
      status: ReservationStatus.PendingPayment,
    });
    expect(selectionBody.payment.status).toBe(PaymentStatus.Pending);
    expect(selectionBody.reservation.expiresAt).toEqual(expect.any(String));
    expect(selectionBody.payment.expiresAt).toBe(
      selectionBody.reservation.expiresAt,
    );

    await agent
      .get('/api/seats')
      .expect(200)
      .expect((response) => {
        const body = response.body as SeatResponse;
        const seat = body.seats.find((candidate) => candidate.id === 'seat-1');
        expect(seat).toMatchObject({
          available: false,
          status: SeatStatus.Pending,
          reservationId: selectionBody.reservation.id,
        });
      });

    const completed = await agent
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .expect(201);
    const completedBody = completed.body as CompletionResponse;

    expect(completedBody.payment.status).toBe(PaymentStatus.Succeeded);
    expect(completedBody.reservation).toMatchObject({
      seatId: 'seat-1',
      status: ReservationStatus.Reserved,
    });

    await agent
      .get('/api/seats')
      .expect(200)
      .expect((response) => {
        const body = response.body as SeatResponse;
        const seat = body.seats.find((candidate) => candidate.id === 'seat-1');
        expect(seat).toMatchObject({
          available: false,
          status: SeatStatus.Reserved,
        });
      });
  });

  it('returns single seat state for available, pending, and reserved seats', async () => {
    const agent = request.agent(app.getHttpServer());

    await request(app.getHttpServer())
      .get('/api/seats/seat-1')
      .expect(200)
      .expect((response) => {
        const body = response.body as SingleSeatResponse;
        expect(body).toEqual({
          seat: {
            id: 'seat-1',
            label: 'Seat 1',
            status: SeatStatus.Available,
            available: true,
          },
        });
        expect(body.seat).not.toHaveProperty('reservationId');
      });

    await agent
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201);

    const selection = await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-1' })
      .expect(201);
    const selectionBody = selection.body as SelectionResponse;

    await agent
      .get('/api/seats/seat-1')
      .expect(200)
      .expect((response) => {
        const body = response.body as SingleSeatResponse;
        expect(body.seat).toEqual({
          id: 'seat-1',
          label: 'Seat 1',
          status: SeatStatus.Pending,
          available: false,
          reservationId: selectionBody.reservation.id,
        });
      });

    await agent
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .expect(201);

    await agent
      .get('/api/seats/seat-1')
      .expect(200)
      .expect((response) => {
        const body = response.body as SingleSeatResponse;
        expect(body.seat).toEqual({
          id: 'seat-1',
          label: 'Seat 1',
          status: SeatStatus.Reserved,
          available: false,
          reservationId: selectionBody.reservation.id,
        });
      });

    await agent
      .get('/api/seats/seat-2')
      .expect(200)
      .expect((response) => {
        const body = response.body as SingleSeatResponse;
        expect(body.seat).toMatchObject({
          id: 'seat-2',
          label: 'Seat 2',
          status: SeatStatus.Available,
          available: true,
        });
        expect(body.seat).not.toHaveProperty('reservationId');
      });
  });

  it('returns 404 for an unknown single seat', async () => {
    await request(app.getHttpServer())
      .get('/api/seats/unknown-seat')
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'Seat not found',
        });
      });
  });

  it('returns auth response shapes and clears the active session on logout', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201)
      .expect('set-cookie', /reservation_session=/)
      .expect('set-cookie', /Max-Age=7776000/)
      .expect('set-cookie', /Path=\//)
      .expect('set-cookie', /HttpOnly/)
      .expect('set-cookie', /SameSite=Lax/)
      .expect((response) => {
        const body = response.body as LoginResponse;
        expect(body.user).toEqual({
          id: 'demo-user',
          username: 'demo@example.com',
        });
        expect(typeof body.expiresAt).toBe('string');
        expect(Date.parse(body.expiresAt)).not.toBeNaN();
      });

    await agent
      .get('/api/auth/session')
      .expect(200)
      .expect((response) => {
        const body = response.body as SessionResponse & { expiresAt: string };
        expect(body).toMatchObject({
          authenticated: true,
          user: {
            id: 'demo-user',
            username: 'demo@example.com',
          },
        });
        expect(typeof body.expiresAt).toBe('string');
      });

    await agent
      .post('/api/auth/logout')
      .expect(201)
      .expect('set-cookie', /reservation_session=; Max-Age=0/)
      .expect('set-cookie', /Path=\//)
      .expect('set-cookie', /HttpOnly/)
      .expect('set-cookie', /SameSite=Lax/)
      .expect((response) => {
        expect(response.body).toEqual({ ok: true });
      });

    await agent
      .get('/api/auth/session')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({ authenticated: false });
      });

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'demo@example.com' })
      .expect(422)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'Username and password are required',
        });
      });
  });

  it('rejects unauthenticated actions and invalid login', async () => {
    await request(app.getHttpServer())
      .post('/api/reservations/select')
      .send({ seatId: 'seat-1' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/payments/unknown/complete')
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'wrong' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('content-type', 'application/json')
      .send('null')
      .expect(422);
  });

  it('enforces reservation and payment controller boundaries', async () => {
    await request(app.getHttpServer())
      .post('/api/reservations/select')
      .send({ seatId: 'seat-1' })
      .expect(401)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'Authentication required',
        });
      });

    await request(app.getHttpServer())
      .post('/api/payments/unknown/complete')
      .expect(401)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'Authentication required',
        });
      });

    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201);

    await agent
      .post('/api/reservations/select')
      .send({ seatId: '' })
      .expect(422)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'seatId is required',
        });
      });

    await agent
      .post('/api/reservations/select')
      .send({ seatId: '   ' })
      .expect(422)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'seatId is required',
        });
      });

    await agent
      .post('/api/reservations/select')
      .send([])
      .expect(422)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'seatId is required',
        });
      });

    await agent
      .post('/api/reservations/select')
      .send({ seatId: 'unknown-seat' })
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'Seat not found',
        });
      });

    await agent
      .post('/api/payments/unknown-payment/complete')
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'Payment not found',
        });
      });

    const selection = await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-2' })
      .expect(201);
    const selectionBody = selection.body as SelectionResponse;
    const otherSessionId = 'other-user-session';

    databaseService.connection
      .prepare(
        `
          INSERT INTO sessions (id, user_id, username, expires_at)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        otherSessionId,
        'other-user',
        'other@example.com',
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      );

    await request(app.getHttpServer())
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .set('Cookie', `reservation_session=${otherSessionId}`)
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          message: 'Payment not found',
        });
      });

    expect(getPaymentStatus(selectionBody.payment.id)).toBe(
      PaymentStatus.Pending,
    );

    await agent
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .expect(201)
      .expect((response) => {
        const body = response.body as CompletionResponse;
        expect(body.payment).toMatchObject({
          id: selectionBody.payment.id,
          status: PaymentStatus.Succeeded,
        });
        expect(body.reservation).toMatchObject({
          seatId: 'seat-2',
          status: ReservationStatus.Reserved,
        });
      });
  });

  it('rejects unavailable seats, unknown payments, and completed payments', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201);

    await agent
      .post('/api/reservations/select')
      .set('content-type', 'application/json')
      .send('null')
      .expect(422);

    const selection = await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-2' })
      .expect(201);
    const selectionBody = selection.body as SelectionResponse;

    await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-2' })
      .expect(409);

    await agent.post('/api/payments/unknown/complete').expect(404);

    await agent
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .expect(201);

    await agent
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .expect(409);
  });

  it('rejects concurrent duplicate seat selection without orphan rows', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201);
    const cookie = loginResponse.headers['set-cookie'];

    const attempts = await Promise.all([
      request(app.getHttpServer())
        .post('/api/reservations/select')
        .set('Cookie', cookie)
        .send({ seatId: 'seat-1' }),
      request(app.getHttpServer())
        .post('/api/reservations/select')
        .set('Cookie', cookie)
        .send({ seatId: 'seat-1' }),
    ]);
    const statuses = attempts
      .map((response) => response.status)
      .sort((left, right) => left - right);
    const conflict = attempts.find((response) => response.status === 409);

    expect(statuses).toEqual([201, 409]);
    expect(conflict?.body).toMatchObject({
      message: 'Seat is not available',
    });
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

  it('expires pending payment completion and releases the seat lazily', async () => {
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201);

    const selection = await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-3' })
      .expect(201);
    const selectionBody = selection.body as SelectionResponse;

    expect(selectionBody.reservation).toMatchObject({
      seatId: 'seat-3',
      status: ReservationStatus.PendingPayment,
      expiresAt: '2026-01-01T01:00:00.000Z',
    });
    expect(selectionBody.payment).toMatchObject({
      status: PaymentStatus.Pending,
      expiresAt: '2026-01-01T01:00:00.000Z',
    });

    jest.setSystemTime(new Date('2026-01-01T01:00:00.000Z'));

    await agent
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .expect(409)
      .expect((response) => {
        const body = response.body as ErrorResponse;
        expect(body.message).toBe('Payment has expired');
      });

    await agent
      .post(`/api/payments/${selectionBody.payment.id}/complete`)
      .expect(409)
      .expect((response) => {
        const body = response.body as ErrorResponse;
        expect(body.message).toBe('Payment has expired');
      });

    await agent
      .get('/api/seats')
      .expect(200)
      .expect((response) => {
        const body = response.body as SeatResponse;
        const seat = body.seats.find((candidate) => candidate.id === 'seat-3');
        expect(seat).toMatchObject({
          available: true,
          status: SeatStatus.Available,
        });
      });

    const retrySelection = await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-3' })
      .expect(201);
    const retrySelectionBody = retrySelection.body as SelectionResponse;

    expect(retrySelectionBody.reservation).toMatchObject({
      seatId: 'seat-3',
      status: ReservationStatus.PendingPayment,
    });
    expect(retrySelectionBody.reservation.id).not.toBe(
      selectionBody.reservation.id,
    );
  });

  it('logs out and clears the session cookie', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201);

    await agent
      .post('/api/auth/logout')
      .expect(201)
      .expect('set-cookie', /reservation_session=; Max-Age=0/);

    await agent
      .post('/api/reservations/select')
      .send({ seatId: 'seat-1' })
      .expect(401);
  });

  function countRows(table: 'payments' | 'reservations'): number {
    return (
      databaseService.connection
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number }
    ).count;
  }

  function getPaymentStatus(paymentId: string): PaymentStatus {
    return (
      databaseService.connection
        .prepare('SELECT status FROM payments WHERE id = ?')
        .get(paymentId) as { status: PaymentStatus }
    ).status;
  }
});

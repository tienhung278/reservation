import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { GatewayController } from '../apps/api-gateway/src/gateway.controller';
import { ServiceProxy } from '../apps/api-gateway/src/service-proxy';
import { UserPrincipal } from '../packages/contracts/src';

describe('api gateway route contract (e2e)', () => {
  let app: INestApplication;
  let server: App;
  let proxy: {
    forward: jest.Mock;
    verifyUser: jest.Mock<Promise<UserPrincipal>>;
  };

  beforeEach(async () => {
    proxy = {
      forward: jest.fn((input: { path: string; target: string }) => ({
        target: input.target,
        path: input.path,
      })),
      verifyUser: jest.fn(() =>
        Promise.resolve({
          id: '00000000-0000-4000-8000-000000000001',
          username: 'demo@example.com',
          tokenVersion: 1,
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [GatewayController],
      providers: [{ provide: ServiceProxy, useValue: proxy }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterEach(async () => {
    await app.close();
  });

  it('preserves login, hold, and complete routes through the gateway', async () => {
    await request(server)
      .post('/api/auth/login')
      .send({ username: 'demo@example.com', password: 'password' })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          target: 'auth',
          path: '/auth/login',
        });
      });

    await request(server)
      .post('/api/reservations/select')
      .send({ seatId: 'seat-1' })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          target: 'seat',
          path: '/reservations/select',
        });
      });

    await request(server)
      .post('/api/payments/payment-1/complete')
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          target: 'payment',
          path: '/payments/payment-1/complete',
        });
      });

    expect(proxy.verifyUser).toHaveBeenCalledTimes(2);
  });
});

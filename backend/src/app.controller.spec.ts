import { AppController, AppStatus } from './app.controller';

describe('AppController', () => {
  it('serves API metadata at the root', () => {
    const controller = new AppController();

    expect(controller.getHome()).toEqual({
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
});

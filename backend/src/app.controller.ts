import { Controller, Get } from '@nestjs/common';

export enum AppStatus {
  Ok = 'ok',
}

interface AppMetadata {
  service: string;
  status: AppStatus;
  endpoints: string[];
}

@Controller()
export class AppController {
  @Get()
  getHome(): AppMetadata {
    return {
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
    };
  }
}

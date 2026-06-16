import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ServiceProxy } from './service-proxy';

@Controller()
export class HealthController {
  constructor(private readonly proxy: ServiceProxy) {}

  @Get()
  home() {
    return {
      service: 'reservation-api-gateway',
      status: 'ok',
      endpoints: [
        'GET /api/seats',
        'GET /api/seats/:seatId',
        'POST /api/auth/login',
        'POST /api/auth/refresh',
        'GET /api/auth/session',
        'POST /api/auth/logout',
        'POST /api/reservations/select',
        'POST /api/payments/:paymentId/complete',
      ],
    };
  }

  @Get('health/live')
  live() {
    return {
      status: 'ok',
      service: 'api-gateway',
      uptime: process.uptime(),
    };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const dependencies = await this.proxy.ready();
    const ready = Object.values(dependencies).every(Boolean);
    if (!ready) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: ready ? 'ready' : 'degraded',
      dependencies,
    };
  }

  @Get('metrics')
  @HttpCode(200)
  metrics() {
    return '# TODO(prod): expose gateway request and upstream latency counters\n';
  }
}

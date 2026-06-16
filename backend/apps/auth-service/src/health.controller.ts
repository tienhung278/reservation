import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PostgresService } from '../../../packages/core/src/postgres';

@Controller()
export class HealthController {
  constructor(private readonly postgres: PostgresService) {}

  @Get('health/live')
  live() {
    return {
      status: 'ok',
      service: 'auth-service',
      uptime: process.uptime(),
    };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const db = await this.postgres.ready();
    if (!db) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: db ? 'ready' : 'degraded',
      dependencies: { postgres: db ? 'ok' : 'down' },
    };
  }

  @Get('metrics')
  @HttpCode(200)
  metrics() {
    return '# TODO(prod): expose prom-client auth counters\n';
  }
}

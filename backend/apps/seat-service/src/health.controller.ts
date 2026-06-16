import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SeatsService } from './seats.service';

@Controller()
export class HealthController {
  constructor(private readonly seatsService: SeatsService) {}

  @Get('health/live')
  live() {
    return {
      status: 'ok',
      service: 'seat-service',
      uptime: process.uptime(),
    };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const ready = await this.seatsService.ready();
    if (!ready) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: ready ? 'ready' : 'degraded',
      dependencies: {
        postgres: ready ? 'ok' : 'check_failed',
        rabbitmq: ready ? 'ok' : 'check_failed',
      },
    };
  }

  @Get('metrics')
  metrics() {
    return '# TODO(prod): expose seats_held and reservations_cancelled counters\n';
  }
}

import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PaymentsService } from './payments.service';

@Controller()
export class HealthController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('health/live')
  live() {
    return {
      status: 'ok',
      service: 'payment-service',
      uptime: process.uptime(),
    };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const ready = await this.paymentsService.ready();
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
  @HttpCode(200)
  metrics() {
    return '# TODO(prod): expose payment_initiate and webhook outcome counters\n';
  }
}

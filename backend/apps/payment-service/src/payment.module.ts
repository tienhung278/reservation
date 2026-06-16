import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import {
  JsonLogger,
  RequestLoggingMiddleware,
} from '../../../packages/core/src/logger';
import { PostgresService } from '../../../packages/core/src/postgres';
import { RabbitMqService } from '../../../packages/core/src/rabbitmq';
import { HealthController } from './health.controller';
import { MockPaymentClient } from './mock-payment-client';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [HealthController, PaymentsController],
  providers: [
    JsonLogger,
    MockPaymentClient,
    PaymentsService,
    PostgresService,
    RabbitMqService,
  ],
})
export class PaymentModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}

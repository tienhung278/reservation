import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import {
  JsonLogger,
  RequestLoggingMiddleware,
} from '../../../packages/core/src/logger';
import { PostgresService } from '../../../packages/core/src/postgres';
import { RabbitMqService } from '../../../packages/core/src/rabbitmq';
import { HealthController } from './health.controller';
import { SeatsController } from './seats.controller';
import { SeatsService } from './seats.service';

@Module({
  controllers: [HealthController, SeatsController],
  providers: [JsonLogger, PostgresService, RabbitMqService, SeatsService],
})
export class SeatModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}

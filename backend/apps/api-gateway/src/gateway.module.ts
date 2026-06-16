import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import {
  JsonLogger,
  RequestLoggingMiddleware,
} from '../../../packages/core/src/logger';
import { GatewayController } from './gateway.controller';
import { HealthController } from './health.controller';
import { ServiceProxy } from './service-proxy';

@Module({
  controllers: [GatewayController, HealthController],
  providers: [JsonLogger, ServiceProxy],
})
export class GatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}

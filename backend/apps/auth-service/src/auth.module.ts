import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import {
  JsonLogger,
  RequestLoggingMiddleware,
} from '../../../packages/core/src/logger';
import { PostgresService } from '../../../packages/core/src/postgres';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [AuthController, HealthController],
  providers: [AuthRepository, AuthService, JsonLogger, PostgresService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}

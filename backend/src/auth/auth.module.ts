import { Module } from '@nestjs/common';
import { RepositoriesModule } from '../database/repositories.module';
import { AuthController } from './auth.controller';
import { AuthenticatedUserInterceptor } from './authenticated-user.interceptor';
import { AuthService } from './auth.service';

@Module({
  imports: [RepositoriesModule],
  controllers: [AuthController],
  providers: [AuthService, AuthenticatedUserInterceptor],
  exports: [AuthService, AuthenticatedUserInterceptor],
})
export class AuthModule {}

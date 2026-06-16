import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { numberEnv } from '../../../packages/core/src/config';
import { InMemoryRateLimiter } from '../../../packages/core/src/rate-limit';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  private readonly loginLimiter = new InMemoryRateLimiter(
    numberEnv('RATE_LIMIT_LOGIN_MAX', 10),
    60_000,
  );

  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  async login(
    @Body() dto: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.enforceLoginLimit(request, response);
    const result = await this.authService.login(dto, request);
    response.setHeader('Set-Cookie', result.cookies);
    return result.body;
  }

  @Post('auth/refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refresh(request);
    response.setHeader('Set-Cookie', result.cookies);
    return result.body;
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(request);
    response.setHeader('Set-Cookie', result.cookies);
    return { ok: true };
  }

  @Get('auth/session')
  async session(@Req() request: Request) {
    return await this.authService.session(request);
  }

  @Post('internal/auth/verify')
  @HttpCode(200)
  async verify(@Req() request: Request) {
    return { user: await this.authService.verify(request) };
  }

  private enforceLoginLimit(request: Request, response: Response): void {
    const decision = this.loginLimiter.consume(request.ip ?? 'unknown');
    response.setHeader('X-RateLimit-Limit', decision.limit);
    response.setHeader('X-RateLimit-Remaining', decision.remaining);

    if (!decision.allowed) {
      response.setHeader('Retry-After', decision.retryAfterSeconds);
      throw new HttpException(
        { message: 'Too many login attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

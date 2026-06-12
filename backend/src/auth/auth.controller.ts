import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { session, cookie } = await this.authService.login(dto);
    response.setHeader('Set-Cookie', cookie);

    return {
      user: session.user,
      expiresAt: session.expiresAt,
    };
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Set-Cookie', await this.authService.logout(request));
    return { ok: true };
  }

  @Get('session')
  async current(@Req() request: Request) {
    const session = await this.authService.getSessionFromRequest(request);

    return session
      ? {
          authenticated: true,
          user: session.user,
          expiresAt: session.expiresAt,
        }
      : { authenticated: false };
  }
}

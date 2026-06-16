import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { RawBodyRequest } from '../../../packages/core/src/http';
import { ServiceProxy } from './service-proxy';

@Controller('api')
export class GatewayController {
  constructor(private readonly proxy: ServiceProxy) {}

  @Post('auth/login')
  async login(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'auth',
      path: '/auth/login',
      request,
      response,
    });
  }

  @Post('auth/refresh')
  async refresh(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'auth',
      path: '/auth/refresh',
      request,
      response,
    });
  }

  @Post('auth/logout')
  async logout(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'auth',
      path: '/auth/logout',
      request,
      response,
    });
  }

  @Get('auth/session')
  async session(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'auth',
      path: '/auth/session',
      request,
      response,
    });
  }

  @Get('seats')
  async seats(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'seat',
      path: '/seats',
      request,
      response,
    });
  }

  @Get('seats/stream')
  async seatStream(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'seat',
      path: '/seats/stream',
      request,
      response,
    });
  }

  @Get('seats/:seatId')
  async seat(
    @Param('seatId') seatId: string,
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'seat',
      path: `/seats/${encodeURIComponent(seatId)}`,
      request,
      response,
    });
  }

  @Post('reservations/select')
  async select(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.proxy.verifyUser(request);
    return await this.proxy.forward({
      target: 'seat',
      path: '/reservations/select',
      request,
      response,
      user,
    });
  }

  @Post('payments/:paymentId/complete')
  async completePayment(
    @Param('paymentId') paymentId: string,
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.proxy.verifyUser(request);
    return await this.proxy.forward({
      target: 'payment',
      path: `/payments/${encodeURIComponent(paymentId)}/complete`,
      request,
      response,
      user,
    });
  }

  @Post('payments/webhook')
  async webhook(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.proxy.forward({
      target: 'payment',
      path: '/payments/webhook',
      request,
      response,
    });
  }
}

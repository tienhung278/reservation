import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requireGatewayUser } from '../../../packages/core/src/gateway-auth';
import { SeatsService } from './seats.service';
import { SeatUnavailableError } from './seat.errors';

@Controller()
export class SeatsController {
  constructor(private readonly seatsService: SeatsService) {}

  @Get('seats')
  async list() {
    return { seats: await this.seatsService.listSeats() };
  }

  @Get('seats/stream')
  @Header('Content-Type', 'text/event-stream')
  stream(@Res() response: Response) {
    response.write('event: ready\n');
    response.write('data: {"ok":true}\n\n');
    response.end();
    // TODO(prod): back this endpoint with Redis pub/sub fan-out for multi-instance seat updates.
  }

  @Get('seats/:seatId')
  async get(@Param('seatId') seatId: string) {
    return { seat: await this.seatsService.getSeat(seatId) };
  }

  @Post('reservations/select')
  async select(
    @Body() dto: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.seatsService.selectSeat(
        dto,
        requireGatewayUser(request),
        request.header('x-request-id'),
      );
    } catch (error) {
      if (error instanceof SeatUnavailableError) {
        response.setHeader('Retry-After', error.retryAfterSeconds);
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }
}

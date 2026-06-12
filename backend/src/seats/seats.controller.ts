import { Controller, Get, Param } from '@nestjs/common';
import { SeatsService } from './seats.service';

@Controller('api/seats')
export class SeatsController {
  constructor(private readonly seatsService: SeatsService) {}

  @Get()
  async list() {
    return { seats: await this.seatsService.listSeats() };
  }

  @Get(':seatId')
  async get(@Param('seatId') seatId: string) {
    return { seat: await this.seatsService.getSeat(seatId) };
  }
}

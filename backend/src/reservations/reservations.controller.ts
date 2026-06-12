import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { AuthenticatedUserInterceptor } from '../auth/authenticated-user.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../auth/auth.types';
import { ReservationsService } from './reservations.service';

@Controller('api/reservations')
@UseInterceptors(AuthenticatedUserInterceptor)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post('select')
  async select(@Body() dto: unknown, @CurrentUser() user: User) {
    return await this.reservationsService.selectSeat(dto, user);
  }
}

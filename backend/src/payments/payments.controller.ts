import { Controller, Param, Post, UseInterceptors } from '@nestjs/common';
import { AuthenticatedUserInterceptor } from '../auth/authenticated-user.interceptor';
import type { User } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReservationsService } from '../reservations/reservations.service';
import { PaymentsService } from './payments.service';

@Controller('api/payments')
@UseInterceptors(AuthenticatedUserInterceptor)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly reservationsService: ReservationsService,
  ) {}

  @Post(':paymentId/complete')
  async complete(
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: User,
  ) {
    const completed = await this.paymentsService.completePayment(
      paymentId,
      user.id,
      (pendingPayment) =>
        this.reservationsService.completeReservationForPayment(
          pendingPayment,
          user,
        ),
      (expiredPayment) =>
        this.reservationsService.expireReservationForPayment(
          expiredPayment,
          user,
        ),
    );

    return { payment: completed.payment, reservation: completed.finalized };
  }
}

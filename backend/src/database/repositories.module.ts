import { Module } from '@nestjs/common';
import { SessionsRepository } from '../auth/sessions.repository';
import { PaymentsRepository } from '../payments/payments.repository';
import { ReservationsRepository } from '../reservations/reservations.repository';
import { SeatsRepository } from '../seats/seats.repository';
import { DatabaseModule } from './database.module';

const repositories = [
  SessionsRepository,
  SeatsRepository,
  ReservationsRepository,
  PaymentsRepository,
];

@Module({
  imports: [DatabaseModule],
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}

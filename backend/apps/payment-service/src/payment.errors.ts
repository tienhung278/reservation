import { ConflictException } from '@nestjs/common';

export class PaymentExpiredException extends ConflictException {
  readonly retryAfterSeconds = 30;

  constructor() {
    super('Payment has expired');
  }
}

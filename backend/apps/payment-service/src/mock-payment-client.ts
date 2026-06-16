import { Injectable } from '@nestjs/common';

export interface PaymentAuthorizationInput {
  paymentId: string;
  amount: number;
  currency: string;
}

export interface PaymentClient {
  authorize(input: PaymentAuthorizationInput): Promise<void>;
}

@Injectable()
export class MockPaymentClient implements PaymentClient {
  authorize(input: PaymentAuthorizationInput): Promise<void> {
    void input;
    // TODO(prod): replace this boundary with a real Stripe client using idempotency keys.
    return Promise.resolve();
  }
}

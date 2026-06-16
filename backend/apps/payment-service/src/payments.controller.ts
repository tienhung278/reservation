import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requireGatewayUser } from '../../../packages/core/src/gateway-auth';
import type { RawBodyRequest } from '../../../packages/core/src/http';
import { PaymentExpiredException } from './payment.errors';
import { PaymentsService } from './payments.service';
import { verifyMockStripeSignature } from './webhook-signature';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payments/:paymentId/complete')
  async complete(
    @Param('paymentId') paymentId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.paymentsService.completePayment(
        paymentId,
        requireGatewayUser(request),
        request.header('x-request-id'),
      );
    } catch (error) {
      if (error instanceof PaymentExpiredException) {
        response.setHeader('Retry-After', error.retryAfterSeconds);
      }

      throw error;
    }
  }

  @Post('payments/webhook')
  async webhook(
    @Body() dto: unknown,
    @Req() request: RawBodyRequest,
    @Headers('mock-stripe-signature') mockSignature: string | undefined,
    @Headers('stripe-signature') stripeSignature: string | undefined,
  ) {
    verifyMockStripeSignature({
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(dto)),
      header: mockSignature ?? stripeSignature,
    });

    return await this.paymentsService.handleWebhook(
      dto,
      request.header('x-request-id'),
    );
  }
}

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { numberEnv, requireEnv } from '../../../packages/core/src/config';

export interface MockStripeSignature {
  timestamp: number;
  signature: string;
}

export function verifyMockStripeSignature(input: {
  rawBody: Buffer;
  header: string | undefined;
  now?: Date;
}): void {
  const parsed = parseSignature(input.header);
  const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  const toleranceSeconds = numberEnv('WEBHOOK_TOLERANCE_SECONDS', 300);

  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    throw new UnauthorizedException('Webhook timestamp outside tolerance');
  }

  const expected = createHmac(
    'sha256',
    requireEnv('MOCK_STRIPE_WEBHOOK_SECRET'),
  )
    .update(`${parsed.timestamp}.${input.rawBody.toString('utf8')}`)
    .digest('hex');

  if (!safeEqualHex(parsed.signature, expected)) {
    throw new UnauthorizedException('Webhook signature invalid');
  }
}

function parseSignature(header: string | undefined): MockStripeSignature {
  if (!header) {
    throw new UnauthorizedException('Webhook signature required');
  }

  const values = new Map(
    header.split(',').map((part) => {
      const separator = part.indexOf('=');
      return separator === -1
        ? [part.trim(), '']
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  const timestamp = Number(values.get('t'));
  const signature = values.get('v1');

  if (!Number.isInteger(timestamp) || !signature) {
    throw new BadRequestException('Webhook signature malformed');
  }

  return { timestamp, signature };
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

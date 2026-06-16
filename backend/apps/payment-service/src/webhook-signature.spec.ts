import { createHmac } from 'node:crypto';
import { verifyMockStripeSignature } from './webhook-signature';

describe('verifyMockStripeSignature', () => {
  const rawBody = Buffer.from(
    JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { paymentId: '00000000-0000-4000-8000-000000000001' },
    }),
  );
  const timestamp = 1_767_225_600;

  beforeEach(() => {
    process.env.MOCK_STRIPE_WEBHOOK_SECRET = 'webhook-secret';
    process.env.WEBHOOK_TOLERANCE_SECONDS = '300';
  });

  afterEach(() => {
    delete process.env.MOCK_STRIPE_WEBHOOK_SECRET;
    delete process.env.WEBHOOK_TOLERANCE_SECONDS;
  });

  it('accepts a valid HMAC signature', () => {
    const signature = createHmac('sha256', 'webhook-secret')
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    expect(() =>
      verifyMockStripeSignature({
        rawBody,
        header: `t=${timestamp},v1=${signature}`,
        now: new Date(timestamp * 1000),
      }),
    ).not.toThrow();
  });

  it('rejects stale timestamps and mismatched signatures', () => {
    const signature = createHmac('sha256', 'webhook-secret')
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    expect(() =>
      verifyMockStripeSignature({
        rawBody,
        header: `t=${timestamp},v1=${signature}`,
        now: new Date((timestamp + 301) * 1000),
      }),
    ).toThrow('Webhook timestamp outside tolerance');

    expect(() =>
      verifyMockStripeSignature({
        rawBody,
        header: `t=${timestamp},v1=${'0'.repeat(64)}`,
        now: new Date(timestamp * 1000),
      }),
    ).toThrow('Webhook signature invalid');
  });
});

import { signAccessToken, verifyAccessToken } from './jwt';

describe('jwt helpers', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('signs and verifies a short-lived access token', () => {
    const signed = signAccessToken({
      userId: '00000000-0000-4000-8000-000000000001',
      username: 'demo@example.com',
      tokenVersion: 3,
      secret: 'test-secret',
      ttlSeconds: 900,
      issuer: 'reservation-auth-service',
      now,
    });

    expect(signed.expiresAt.toISOString()).toBe('2026-01-01T00:15:00.000Z');
    expect(
      verifyAccessToken({
        token: signed.token,
        secret: 'test-secret',
        issuer: 'reservation-auth-service',
        now,
      }),
    ).toMatchObject({
      userId: '00000000-0000-4000-8000-000000000001',
      username: 'demo@example.com',
      tokenVersion: 3,
    });
  });

  it('rejects expired tokens and wrong issuers', () => {
    const signed = signAccessToken({
      userId: '00000000-0000-4000-8000-000000000001',
      username: 'demo@example.com',
      tokenVersion: 1,
      secret: 'test-secret',
      ttlSeconds: 1,
      issuer: 'reservation-auth-service',
      now,
    });

    expect(() =>
      verifyAccessToken({
        token: signed.token,
        secret: 'test-secret',
        issuer: 'reservation-auth-service',
        now: new Date('2026-01-01T00:00:02.000Z'),
      }),
    ).toThrow('Access token expired');

    expect(() =>
      verifyAccessToken({
        token: signed.token,
        secret: 'test-secret',
        issuer: 'other-service',
        now,
      }),
    ).toThrow('Invalid access token payload');
  });
});

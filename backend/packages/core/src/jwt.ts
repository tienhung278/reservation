import { createHmac, timingSafeEqual } from 'node:crypto';

interface AccessTokenPayload {
  sub: string;
  username: string;
  tokenVersion: number;
  iat: number;
  exp: number;
  iss: string;
}

export interface VerifiedAccessToken {
  userId: string;
  username: string;
  tokenVersion: number;
  expiresAt: Date;
}

export function signAccessToken(input: {
  userId: string;
  username: string;
  tokenVersion: number;
  secret: string;
  ttlSeconds: number;
  issuer: string;
  now?: Date;
}): { token: string; expiresAt: Date } {
  const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  const expiresAtSeconds = nowSeconds + input.ttlSeconds;
  const payload: AccessTokenPayload = {
    sub: input.userId,
    username: input.username,
    tokenVersion: input.tokenVersion,
    iat: nowSeconds,
    exp: expiresAtSeconds,
    iss: input.issuer,
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = hmac(unsigned, input.secret);

  return {
    token: `${unsigned}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

export function verifyAccessToken(input: {
  token: string;
  secret: string;
  issuer: string;
  now?: Date;
}): VerifiedAccessToken {
  const parts = input.token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid access token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expected = hmac(unsigned, input.secret);

  if (!safeEqual(signature, expected)) {
    throw new Error('Invalid access token signature');
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as Partial<AccessTokenPayload>;

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.username !== 'string' ||
    typeof payload.tokenVersion !== 'number' ||
    typeof payload.exp !== 'number' ||
    payload.iss !== input.issuer
  ) {
    throw new Error('Invalid access token payload');
  }

  const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  if (payload.exp <= nowSeconds) {
    throw new Error('Access token expired');
  }

  return {
    userId: payload.sub,
    username: payload.username,
    tokenVersion: payload.tokenVersion,
    expiresAt: new Date(payload.exp * 1000),
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

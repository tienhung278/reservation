import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { UserPrincipal } from '../../../packages/contracts/src';
import { requireEnv } from './config';

export const INTERNAL_GATEWAY_SECRET_HEADER = 'x-internal-gateway-secret';
export const INTERNAL_USER_ID_HEADER = 'x-user-id';
export const INTERNAL_USERNAME_HEADER = 'x-user-name';
export const INTERNAL_TOKEN_VERSION_HEADER = 'x-token-version';

export function requireGatewayUser(request: Request): UserPrincipal {
  const expectedSecret = requireEnv('INTERNAL_GATEWAY_SECRET');
  const actualSecret = request.header(INTERNAL_GATEWAY_SECRET_HEADER);
  if (actualSecret !== expectedSecret) {
    throw new UnauthorizedException('Gateway authentication required');
  }

  const id = request.header(INTERNAL_USER_ID_HEADER);
  const username = request.header(INTERNAL_USERNAME_HEADER);
  const tokenVersion = Number(request.header(INTERNAL_TOKEN_VERSION_HEADER));

  if (!id || !username || !Number.isInteger(tokenVersion)) {
    throw new UnauthorizedException('Gateway user headers are required');
  }

  return { id, username, tokenVersion };
}

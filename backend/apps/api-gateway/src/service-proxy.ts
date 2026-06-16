import {
  BadGatewayException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response as ExpressResponse } from 'express';
import {
  INTERNAL_GATEWAY_SECRET_HEADER,
  INTERNAL_TOKEN_VERSION_HEADER,
  INTERNAL_USER_ID_HEADER,
  INTERNAL_USERNAME_HEADER,
} from '../../../packages/core/src/gateway-auth';
import type { RawBodyRequest } from '../../../packages/core/src/http';
import { logError } from '../../../packages/core/src/logger';
import { optionalEnv, requireEnv } from '../../../packages/core/src/config';
import type { UserPrincipal } from '../../../packages/contracts/src';

export interface ForwardOptions {
  target: 'auth' | 'payment' | 'seat';
  path: string;
  request: RawBodyRequest;
  response: ExpressResponse;
  user?: UserPrincipal;
}

@Injectable()
export class ServiceProxy {
  private readonly authBase = optionalEnv(
    'AUTH_SERVICE_URL',
    'http://localhost:3001',
  );
  private readonly seatBase = optionalEnv(
    'SEAT_SERVICE_URL',
    'http://localhost:3002',
  );
  private readonly paymentBase = optionalEnv(
    'PAYMENT_SERVICE_URL',
    'http://localhost:3003',
  );

  async forward(options: ForwardOptions): Promise<unknown> {
    const url = `${this.baseUrl(options.target)}${options.path}`;
    const headers = this.buildHeaders(options.request, options.user);
    const body = shouldSendBody(options.request)
      ? (
          options.request.rawBody ??
          Buffer.from(JSON.stringify(options.request.body ?? {}))
        ).toString('utf8')
      : undefined;

    try {
      const upstream = await fetch(url, {
        method: options.request.method,
        headers,
        body,
      });

      copyResponseMetadata(upstream, options.response);
      options.response.status(upstream.status);
      return await parseUpstreamBody(upstream);
    } catch (error) {
      logError({
        action: 'gateway_proxy_failed',
        target: options.target,
        path: options.path,
        error,
      });
      throw new BadGatewayException('Upstream service unavailable');
    }
  }

  async verifyUser(request: Request): Promise<UserPrincipal> {
    const upstream = await fetch(`${this.authBase}/internal/auth/verify`, {
      method: 'POST',
      headers: this.buildHeaders(request),
    });

    if (!upstream.ok) {
      throw new UnauthorizedException('Authentication required');
    }

    const body = (await upstream.json()) as { user?: UserPrincipal };
    if (!body.user) {
      throw new UnauthorizedException('Authentication required');
    }

    return body.user;
  }

  async ready(): Promise<Record<string, boolean>> {
    const entries = await Promise.all(
      [
        ['auth', this.authBase],
        ['seat', this.seatBase],
        ['payment', this.paymentBase],
      ].map(async ([name, base]) => {
        try {
          const response = await fetch(`${base}/health/ready`);
          return [name, response.ok] as const;
        } catch {
          return [name, false] as const;
        }
      }),
    );

    return Object.fromEntries(entries);
  }

  private buildHeaders(
    request: Request,
    user?: UserPrincipal,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'x-request-id': request.header('x-request-id') ?? '',
    };

    const cookie = request.header('cookie');
    if (cookie) {
      headers.cookie = cookie;
    }

    const authorization = request.header('authorization');
    if (authorization) {
      headers.authorization = authorization;
    }

    const contentType = request.header('content-type');
    if (contentType) {
      headers['content-type'] = contentType;
    }

    const mockSignature = request.header('mock-stripe-signature');
    const stripeSignature = request.header('stripe-signature');
    if (mockSignature) {
      headers['mock-stripe-signature'] = mockSignature;
    }
    if (stripeSignature) {
      headers['stripe-signature'] = stripeSignature;
    }

    if (user) {
      headers[INTERNAL_GATEWAY_SECRET_HEADER] = requireEnv(
        'INTERNAL_GATEWAY_SECRET',
      );
      headers[INTERNAL_USER_ID_HEADER] = user.id;
      headers[INTERNAL_USERNAME_HEADER] = user.username;
      headers[INTERNAL_TOKEN_VERSION_HEADER] = String(user.tokenVersion);
    }

    return headers;
  }

  private baseUrl(target: ForwardOptions['target']): string {
    if (target === 'auth') {
      return this.authBase;
    }
    if (target === 'seat') {
      return this.seatBase;
    }
    return this.paymentBase;
  }
}

function shouldSendBody(request: Request): boolean {
  return !['GET', 'HEAD'].includes(request.method.toUpperCase());
}

function copyResponseMetadata(
  upstream: globalThis.Response,
  response: ExpressResponse,
): void {
  const contentType = upstream.headers.get('content-type');
  if (contentType) {
    response.setHeader('content-type', contentType);
  }

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) {
    response.setHeader('retry-after', retryAfter);
  }

  const headersWithSetCookie: Headers & { getSetCookie?: () => string[] } =
    upstream.headers;
  const setCookies = headersWithSetCookie.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    response.setHeader('set-cookie', setCookies);
    return;
  }

  const singleSetCookie = upstream.headers.get('set-cookie');
  if (singleSetCookie) {
    response.setHeader('set-cookie', singleSetCookie);
  }
}

async function parseUpstreamBody(
  upstream: globalThis.Response,
): Promise<unknown> {
  const text = await upstream.text();
  if (!text) {
    return undefined;
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return JSON.parse(text) as unknown;
  }

  return text;
}

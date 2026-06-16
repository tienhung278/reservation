import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { UserPrincipal } from '../../../packages/contracts/src';
import {
  optionalEnv,
  requireEnv,
  isProduction,
  numberEnv,
} from '../../../packages/core/src/config';
import {
  parseCookies,
  serializeCookie,
} from '../../../packages/core/src/cookies';
import {
  randomToken,
  sha256Base64Url,
  timingSafeStringEqual,
} from '../../../packages/core/src/crypto';
import {
  signAccessToken,
  verifyAccessToken,
} from '../../../packages/core/src/jwt';
import { logInfo, logWarn } from '../../../packages/core/src/logger';
import {
  hashPassword,
  verifyPasswordOrDummy,
} from '../../../packages/core/src/password';
import { DbClient, PostgresService } from '../../../packages/core/src/postgres';
import {
  AuthRepository,
  AuthUserRecord,
  RefreshTokenRecord,
} from './auth.repository';

export const ACCESS_COOKIE_NAME = 'reservation_access';
export const REFRESH_COOKIE_NAME = 'reservation_refresh';
const JWT_ISSUER = 'reservation-auth-service';

interface LoginResult {
  body: {
    user: { id: string; username: string };
    expiresAt: string;
    accessToken: string;
  };
  cookies: string[];
}

type RefreshResult =
  | { type: 'ok'; result: LoginResult }
  | { type: 'expired' }
  | { type: 'reuse_detected' };

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly postgres: PostgresService,
    private readonly repository: AuthRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const username = optionalEnv('DEMO_USERNAME', 'demo@example.com');
    const password = optionalEnv('DEMO_PASSWORD', 'password');
    await this.repository.upsertDemoUser({
      username,
      passwordHash: await hashPassword(password),
    });
  }

  async login(dto: unknown, request: Request): Promise<LoginResult> {
    const credentials = parseLoginDto(dto);
    const user = await this.repository.findUserByUsername(credentials.username);
    const passwordOk = await verifyPasswordOrDummy({
      passwordHash: user?.passwordHash,
      password: credentials.password,
    });

    if (!user || !passwordOk) {
      await this.repository.insertAudit({
        action: 'login_failed',
        traceId: request.header('x-request-id'),
        metadata: { username: credentials.username, ip: request.ip },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.repository.insertAudit({
      action: 'login',
      userId: user.id,
      traceId: request.header('x-request-id'),
      metadata: { ip: request.ip },
    });

    return await this.issueNewTokenFamily(user);
  }

  async refresh(request: Request): Promise<LoginResult> {
    const rawRefreshToken = this.readRefreshToken(request);
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    const tokenHash = sha256Base64Url(rawRefreshToken);
    const refresh = await this.postgres.transaction<RefreshResult>(
      async (client) => {
        const token = await this.repository.findRefreshTokenByHashForUpdate({
          client,
          tokenHash,
        });
        if (!token || !timingSafeStringEqual(token.tokenHash, tokenHash)) {
          throw new UnauthorizedException('Refresh token invalid');
        }

        const now = new Date();
        const user = await this.repository.findUserById(token.userId, client);
        if (!user) {
          throw new UnauthorizedException('Refresh token invalid');
        }

        if (token.expiresAt.getTime() <= now.getTime()) {
          await this.repository.revokeRefreshTokenFamily({
            client,
            familyId: token.familyId,
          });
          return { type: 'expired' };
        }

        if (token.revokedAt) {
          if (token.rotatedToTokenId && isWithinGrace(token, now)) {
            logInfo({
              action: 'refresh_retry_within_grace',
              userId: token.userId,
              traceId: request.header('x-request-id'),
            });
            return { type: 'ok', result: this.buildAccessOnlyResult(user) };
          }

          await this.repository.revokeRefreshTokenFamily({
            client,
            familyId: token.familyId,
          });
          await this.repository.bumpTokenVersion({
            client,
            userId: token.userId,
          });
          await this.repository.insertAudit({
            client,
            action: 'refresh_reuse_detected',
            userId: token.userId,
            traceId: request.header('x-request-id'),
            metadata: { familyId: token.familyId },
          });
          logWarn({
            action: 'refresh_reuse_detected',
            userId: token.userId,
            traceId: request.header('x-request-id'),
          });
          return { type: 'reuse_detected' };
        }

        return {
          type: 'ok',
          result: await this.rotateRefreshToken(user, token, client),
        };
      },
    );

    if (refresh.type === 'expired') {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (refresh.type === 'reuse_detected') {
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    return refresh.result;
  }

  async logout(request: Request): Promise<{ cookies: string[] }> {
    const principal = await this.authenticateOptional(request);
    const refreshToken = this.readRefreshToken(request);
    const refreshRecord = refreshToken
      ? await this.repository.findRefreshTokenByHash(
          sha256Base64Url(refreshToken),
        )
      : undefined;
    const userId = principal?.id ?? refreshRecord?.userId;

    if (userId) {
      await this.postgres.transaction(async (client) => {
        await this.repository.revokeAllRefreshTokensForUser({ client, userId });
        await this.repository.bumpTokenVersion({ client, userId });
        await this.repository.insertAudit({
          client,
          action: 'logout',
          userId,
          traceId: request.header('x-request-id'),
        });
      });
    }

    return { cookies: this.clearCookies() };
  }

  async session(request: Request): Promise<
    | { authenticated: false }
    | {
        authenticated: true;
        user: { id: string; username: string };
        expiresAt: string;
      }
  > {
    const principal = await this.authenticateOptional(request);
    if (!principal) {
      return { authenticated: false };
    }

    const access = this.readAccessToken(request);
    const verified = access
      ? verifyAccessToken({
          token: access,
          secret: requireEnv('JWT_SECRET'),
          issuer: JWT_ISSUER,
        })
      : undefined;

    return {
      authenticated: true,
      user: { id: principal.id, username: principal.username },
      expiresAt: verified?.expiresAt.toISOString() ?? new Date().toISOString(),
    };
  }

  async verify(request: Request): Promise<UserPrincipal> {
    const principal = await this.authenticateOptional(request);
    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }

    return principal;
  }

  private async authenticateOptional(
    request: Request,
  ): Promise<UserPrincipal | undefined> {
    const accessToken = this.readAccessToken(request);
    if (!accessToken) {
      return undefined;
    }

    try {
      const verified = verifyAccessToken({
        token: accessToken,
        secret: requireEnv('JWT_SECRET'),
        issuer: JWT_ISSUER,
      });
      const user = await this.repository.findUserById(verified.userId);
      if (!user || user.tokenVersion !== verified.tokenVersion) {
        return undefined;
      }

      return {
        id: user.id,
        username: user.username,
        tokenVersion: user.tokenVersion,
      };
    } catch {
      return undefined;
    }
  }

  private async issueNewTokenFamily(
    user: AuthUserRecord,
  ): Promise<LoginResult> {
    const refreshTokenId = randomUUID();
    const familyId = refreshTokenId;
    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(
      Date.now() +
        numberEnv('REFRESH_TOKEN_TTL_DAYS', 30) * 24 * 60 * 60 * 1000,
    );

    await this.repository.createRefreshToken({
      id: refreshTokenId,
      userId: user.id,
      tokenHash: sha256Base64Url(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
    });

    return this.buildLoginResult(user, refreshToken, refreshExpiresAt);
  }

  private async rotateRefreshToken(
    user: AuthUserRecord,
    oldToken: RefreshTokenRecord,
    client: DbClient,
  ): Promise<LoginResult> {
    const newTokenId = randomUUID();
    const rawRefreshToken = randomToken(48);
    const refreshExpiresAt = new Date(
      Date.now() +
        numberEnv('REFRESH_TOKEN_TTL_DAYS', 30) * 24 * 60 * 60 * 1000,
    );
    const graceUntil = new Date(
      Date.now() + numberEnv('REFRESH_ROTATION_GRACE_SECONDS', 30) * 1000,
    );

    const rotated = await this.repository.rotateRefreshToken({
      client,
      oldTokenId: oldToken.id,
      newTokenId,
      graceUntil,
    });

    if (!rotated) {
      return this.buildAccessOnlyResult(user);
    }

    await this.repository.createRefreshToken({
      client,
      id: newTokenId,
      userId: user.id,
      tokenHash: sha256Base64Url(rawRefreshToken),
      familyId: oldToken.familyId,
      expiresAt: refreshExpiresAt,
    });
    await this.repository.insertAudit({
      client,
      action: 'refresh_rotate',
      userId: user.id,
      metadata: { familyId: oldToken.familyId },
    });

    return this.buildLoginResult(user, rawRefreshToken, refreshExpiresAt);
  }

  private buildAccessOnlyResult(user: AuthUserRecord): LoginResult {
    const access = signAccessToken({
      userId: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
      secret: requireEnv('JWT_SECRET'),
      ttlSeconds: numberEnv('JWT_ACCESS_TTL_SECONDS', 900),
      issuer: JWT_ISSUER,
    });

    return {
      body: {
        user: { id: user.id, username: user.username },
        expiresAt: access.expiresAt.toISOString(),
        accessToken: access.token,
      },
      cookies: [
        serializeCookie(ACCESS_COOKIE_NAME, access.token, {
          httpOnly: true,
          secure: isProduction(),
          sameSite: 'Strict',
          path: '/',
          maxAgeSeconds: numberEnv('JWT_ACCESS_TTL_SECONDS', 900),
        }),
      ],
    };
  }

  private buildLoginResult(
    user: AuthUserRecord,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): LoginResult {
    const access = signAccessToken({
      userId: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
      secret: requireEnv('JWT_SECRET'),
      ttlSeconds: numberEnv('JWT_ACCESS_TTL_SECONDS', 900),
      issuer: JWT_ISSUER,
    });

    return {
      body: {
        user: { id: user.id, username: user.username },
        expiresAt: access.expiresAt.toISOString(),
        accessToken: access.token,
      },
      cookies: [
        serializeCookie(ACCESS_COOKIE_NAME, access.token, {
          httpOnly: true,
          secure: isProduction(),
          sameSite: 'Strict',
          path: '/',
          maxAgeSeconds: numberEnv('JWT_ACCESS_TTL_SECONDS', 900),
        }),
        serializeCookie(REFRESH_COOKIE_NAME, refreshToken, {
          httpOnly: true,
          secure: isProduction(),
          sameSite: 'Strict',
          path: '/api/auth',
          maxAgeSeconds: Math.floor(
            (refreshExpiresAt.getTime() - Date.now()) / 1000,
          ),
        }),
      ],
    };
  }

  private readAccessToken(request: Request): string | undefined {
    const authorization = request.header('authorization');
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      return authorization.slice('bearer '.length).trim();
    }

    return parseCookies(request.header('cookie')).get(ACCESS_COOKIE_NAME);
  }

  private readRefreshToken(request: Request): string | undefined {
    return parseCookies(request.header('cookie')).get(REFRESH_COOKIE_NAME);
  }

  private clearCookies(): string[] {
    return [
      serializeCookie(ACCESS_COOKIE_NAME, '', {
        httpOnly: true,
        secure: isProduction(),
        sameSite: 'Strict',
        path: '/',
        maxAgeSeconds: 0,
      }),
      serializeCookie(REFRESH_COOKIE_NAME, '', {
        httpOnly: true,
        secure: isProduction(),
        sameSite: 'Strict',
        path: '/api/auth',
        maxAgeSeconds: 0,
      }),
    ];
  }
}

function parseLoginDto(dto: unknown): { username: string; password: string } {
  if (!isRecord(dto)) {
    throw new UnprocessableEntityException(
      'Username and password are required',
    );
  }

  if (typeof dto.username !== 'string' || typeof dto.password !== 'string') {
    throw new UnprocessableEntityException(
      'Username and password are required',
    );
  }

  return { username: dto.username, password: dto.password };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithinGrace(token: RefreshTokenRecord, now: Date): boolean {
  return Boolean(
    token.graceUntil && token.graceUntil.getTime() >= now.getTime(),
  );
}

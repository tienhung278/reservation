import {
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { readCookie, serializeCookie } from '../shared/cookies';
import { Session, User } from './auth.types';
import { SessionsRepository } from './sessions.repository';

export const SESSION_COOKIE_NAME = 'reservation_session';
export const SESSION_TTL_DAYS = 90;
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(private readonly sessionsRepository: SessionsRepository) {}

  async login(dto: unknown): Promise<{ session: Session; cookie: string }> {
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

    const expectedUsername = process.env.DEMO_USERNAME ?? 'demo@example.com';
    const expectedPassword = process.env.DEMO_PASSWORD ?? 'password';

    if (
      dto.username !== expectedUsername ||
      dto.password !== expectedPassword
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const session: Session = {
      id: randomUUID(),
      user: {
        id: 'demo-user',
        username: dto.username,
      },
      expiresAt: new Date(
        Date.now() + SESSION_TTL_SECONDS * 1000,
      ).toISOString(),
    };

    await this.sessionsRepository.create(session);

    return {
      session,
      cookie: serializeCookie(SESSION_COOKIE_NAME, session.id, {
        httpOnly: true,
        maxAgeSeconds: SESSION_TTL_SECONDS,
        path: '/',
        sameSite: 'Lax',
      }),
    };
  }

  async logout(request: Request): Promise<string> {
    const sessionId = readCookie(request, SESSION_COOKIE_NAME);
    if (sessionId) {
      await this.sessionsRepository.deleteById(sessionId);
    }

    return serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      maxAgeSeconds: 0,
      path: '/',
      sameSite: 'Lax',
    });
  }

  async getSessionFromRequest(request: Request): Promise<Session | undefined> {
    const sessionId = readCookie(request, SESSION_COOKIE_NAME);
    if (!sessionId) {
      return undefined;
    }

    const session = await this.sessionsRepository.findById(sessionId);

    if (!session) {
      return undefined;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.sessionsRepository.deleteById(sessionId);
      return undefined;
    }

    return session;
  }

  async requireUser(request: Request): Promise<User> {
    const session = await this.getSessionFromRequest(request);
    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    return session.user;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

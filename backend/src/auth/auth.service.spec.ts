import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import {
  AuthService,
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
} from './auth.service';
import { DatabaseService } from '../database/database.service';
import { SessionsRepository } from './sessions.repository';

describe('AuthService', () => {
  let databaseService: DatabaseService;
  let sessionsRepository: SessionsRepository;
  let service: AuthService;

  beforeEach(() => {
    databaseService = new DatabaseService();
    sessionsRepository = new SessionsRepository(databaseService);
    service = new AuthService(sessionsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    databaseService.close();
  });

  it('creates a 90 day http-only session cookie', async () => {
    const result = await service.login({
      username: 'demo@example.com',
      password: 'password',
    });

    expect(result.session.user.username).toBe('demo@example.com');
    expect(result.cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(result.cookie).toContain('HttpOnly');
    expect(result.cookie).toContain(
      `Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`,
    );
  });

  it('rejects invalid credentials', async () => {
    await expect(
      service.login({ username: 'demo@example.com', password: 'bad' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('resolves the current user from a valid request cookie', async () => {
    const result = await service.login({
      username: 'demo@example.com',
      password: 'password',
    });
    const cookiePair = result.cookie.split(';')[0];
    const request = {
      headers: { cookie: cookiePair },
    } as Request;

    await expect(service.requireUser(request)).resolves.toEqual({
      id: 'demo-user',
      username: 'demo@example.com',
    });
  });

  it('deletes expired sessions during lookup', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const result = await service.login({
      username: 'demo@example.com',
      password: 'password',
    });
    const cookiePair = result.cookie.split(';')[0];
    const request = {
      headers: { cookie: cookiePair },
    } as Request;

    jest.setSystemTime(new Date(result.session.expiresAt));

    await expect(
      service.getSessionFromRequest(request),
    ).resolves.toBeUndefined();
    expect(
      (
        databaseService.connection
          .prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?')
          .get(result.session.id) as { count: number }
      ).count,
    ).toBe(0);
  });

  it('returns a clearing cookie when logout receives no session cookie', async () => {
    const deleteById = jest.spyOn(sessionsRepository, 'deleteById');
    const cookie = await service.logout({ headers: {} } as Request);

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('Max-Age=0');
    expect(deleteById).not.toHaveBeenCalled();
  });
});

import {
  CallHandler,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import type { AuthenticatedRequest } from './authenticated-request';
import { AuthService } from './auth.service';
import { AuthenticatedUserInterceptor } from './authenticated-user.interceptor';
import type { User } from './auth.types';

describe('AuthenticatedUserInterceptor', () => {
  it('attaches the current user before continuing to controller logic', async () => {
    const request = {} as AuthenticatedRequest;
    const user: User = { id: 'user-1', username: 'user@example.com' };
    const requireUser = jest.fn(() => user);
    const authService = {
      requireUser,
    } as unknown as AuthService;
    const handle = jest.fn(() => of('ok'));
    const next = {
      handle,
    } as unknown as CallHandler;
    const interceptor = new AuthenticatedUserInterceptor(authService);

    await expect(
      lastValueFrom(await interceptor.intercept(createContext(request), next)),
    ).resolves.toBe('ok');

    expect(requireUser).toHaveBeenCalledWith(request);
    expect(request.user).toBe(user);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing unauthorized behavior from AuthService', async () => {
    const request = {} as AuthenticatedRequest;
    const requireUser = jest.fn(() => {
      throw new UnauthorizedException('Authentication required');
    });
    const authService = {
      requireUser,
    } as unknown as AuthService;
    const handle = jest.fn();
    const next = {
      handle,
    } as unknown as CallHandler;
    const interceptor = new AuthenticatedUserInterceptor(authService);

    await expect(
      interceptor.intercept(createContext(request), next),
    ).rejects.toThrow(UnauthorizedException);
    expect(handle).not.toHaveBeenCalled();
  });
});

function createContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

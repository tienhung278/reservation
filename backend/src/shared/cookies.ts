import { Request } from 'express';

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }

  return header
    .split(';')
    .map((part) => part.trim())
    .map((part) => {
      const separator = part.indexOf('=');
      return separator === -1
        ? [part, '']
        : [part.slice(0, separator), part.slice(separator + 1)];
    })
    .find(([cookieName]) => cookieName === name)?.[1];
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    maxAgeSeconds?: number;
    path?: string;
    sameSite?: 'Lax' | 'Strict' | 'None';
  },
): string {
  const parts = [`${name}=${value}`];

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }

  parts.push(`Path=${options.path ?? '/'}`);

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join('; ');
}

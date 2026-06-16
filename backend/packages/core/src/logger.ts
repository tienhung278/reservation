import { Injectable, LoggerService, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface LogFields {
  action: string;
  traceId?: string;
  userId?: string;
  [key: string]: unknown;
}

@Injectable()
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    writeLog('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    writeLog('error', message, context, { trace });
  }

  warn(message: unknown, context?: string): void {
    writeLog('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    if (process.env.LOG_LEVEL === 'debug') {
      writeLog('debug', message, context);
    }
  }
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incomingTrace = request.header('x-request-id');
    const traceId =
      incomingTrace && incomingTrace.trim() ? incomingTrace : randomUUID();
    request.headers['x-request-id'] = traceId;
    response.setHeader('x-request-id', traceId);
    const startedAt = Date.now();

    response.on('finish', () => {
      logInfo({
        action: 'http_request',
        traceId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  }
}

export function logInfo(fields: LogFields): void {
  writeLog('info', fields.action, undefined, fields);
}

export function logWarn(fields: LogFields): void {
  writeLog('warn', fields.action, undefined, fields);
}

export function logError(fields: LogFields & { error?: unknown }): void {
  writeLog('error', fields.action, undefined, {
    ...fields,
    error: fields.error instanceof Error ? fields.error.message : fields.error,
  });
}

function writeLog(
  level: 'debug' | 'error' | 'info' | 'warn',
  message: unknown,
  context?: string,
  extra: Record<string, unknown> = {},
): void {
  const body = {
    timestamp: new Date().toISOString(),
    level,
    service: process.env.SERVICE_NAME ?? 'reservation-service',
    context,
    message: typeof message === 'string' ? message : undefined,
    ...extra,
  };

  process.stdout.write(`${JSON.stringify(body)}\n`);
}

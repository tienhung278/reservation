import { INestApplication } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { optionalEnv } from './config';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

type CorsCallback = (error: Error | null, allow?: boolean) => void;

export function configureHttpApp(app: INestApplication): void {
  app.enableShutdownHooks();
  app.enableCors({
    credentials: true,
    origin(origin: string | undefined, callback: CorsCallback): void {
      const allowed = optionalEnv(
        'CORS_ORIGINS',
        'http://localhost:3000,http://localhost:3001,http://localhost:5173',
      )
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (!origin || allowed.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'));
    },
    allowedHeaders: [
      'authorization',
      'content-type',
      'mock-stripe-signature',
      'stripe-signature',
      'x-request-id',
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.use((request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  app.use(
    express.json({
      limit: '1mb',
      verify(request: RawBodyRequest, _response: Response, buffer: Buffer) {
        request.rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
}

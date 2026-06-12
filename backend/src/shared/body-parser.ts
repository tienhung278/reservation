import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

export function useRequestBodyParsers(app: INestApplication): void {
  app.use(json({ strict: false }));
  app.use(urlencoded({ extended: true }));
}

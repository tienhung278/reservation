import { NestFactory } from '@nestjs/core';
import { AuthModule } from './auth.module';
import { configureHttpApp } from '../../../packages/core/src/http';
import { JsonLogger } from '../../../packages/core/src/logger';
import { numberEnv } from '../../../packages/core/src/config';

async function bootstrap(): Promise<void> {
  process.env.SERVICE_NAME = process.env.SERVICE_NAME ?? 'auth-service';
  const app = await NestFactory.create(AuthModule, {
    bodyParser: false,
    logger: new JsonLogger(),
  });
  configureHttpApp(app);
  await app.listen(numberEnv('PORT', 3001));
}

void bootstrap();

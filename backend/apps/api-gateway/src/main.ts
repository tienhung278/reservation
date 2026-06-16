import { NestFactory } from '@nestjs/core';
import { numberEnv } from '../../../packages/core/src/config';
import { configureHttpApp } from '../../../packages/core/src/http';
import { JsonLogger } from '../../../packages/core/src/logger';
import { GatewayModule } from './gateway.module';

async function bootstrap(): Promise<void> {
  process.env.SERVICE_NAME = process.env.SERVICE_NAME ?? 'api-gateway';
  const app = await NestFactory.create(GatewayModule, {
    bodyParser: false,
    logger: new JsonLogger(),
  });
  configureHttpApp(app);
  await app.listen(numberEnv('PORT', 3000));
}

void bootstrap();

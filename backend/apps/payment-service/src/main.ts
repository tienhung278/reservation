import { NestFactory } from '@nestjs/core';
import { numberEnv } from '../../../packages/core/src/config';
import { configureHttpApp } from '../../../packages/core/src/http';
import { JsonLogger } from '../../../packages/core/src/logger';
import { PaymentModule } from './payment.module';

async function bootstrap(): Promise<void> {
  process.env.SERVICE_NAME = process.env.SERVICE_NAME ?? 'payment-service';
  const app = await NestFactory.create(PaymentModule, {
    bodyParser: false,
    logger: new JsonLogger(),
  });
  configureHttpApp(app);
  await app.listen(numberEnv('PORT', 3003));
}

void bootstrap();

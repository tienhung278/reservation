import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('backend architecture contract', () => {
  const root = join(__dirname, '..');

  it('declares independently deployable services and RabbitMQ infrastructure', () => {
    const compose = readFileSync(
      join(root, 'infra', 'docker-compose.yml'),
      'utf8',
    );

    expect(compose).toContain('auth-service:');
    expect(compose).toContain('seat-service:');
    expect(compose).toContain('payment-service:');
    expect(compose).toContain('api-gateway:');
    expect(compose).toContain('rabbitmq:');
    expect(compose).toContain('condition: service_healthy');
  });

  it('creates Postgres invariants for seat concurrency and idempotency', () => {
    const migration = readFileSync(
      join(root, 'infra', 'postgres', 'migrations', '001_init.sql'),
      'utf8',
    );
    const seatService = readFileSync(
      join(root, 'apps', 'seat-service', 'src', 'seats.service.ts'),
      'utf8',
    );

    expect(migration).toContain('reservations_one_active_per_seat');
    expect(migration).toContain('reservations_one_active_hold_per_user');
    expect(seatService).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('eventing.inbox');
    expect(migration).toContain('payment.webhook_events');
  });
});

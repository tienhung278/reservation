import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('backend architecture contract', () => {
  const root = join(__dirname, '..');
  const readMigration = (service: 'auth' | 'seat' | 'payment') =>
    readFileSync(
      join(root, 'infra', 'postgres', service, 'migrations', '001_init.sql'),
      'utf8',
    );
  const serviceBlock = (compose: string, serviceName: string): string => {
    const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = compose.match(
      new RegExp(
        `(?:^|\\r?\\n)  ${escaped}:\\r?\\n([\\s\\S]*?)(?=\\r?\\n  [A-Za-z0-9-]+:\\r?\\n|\\r?\\nvolumes:|$)`,
      ),
    );
    expect(match).toBeTruthy();

    return match?.[1] ?? '';
  };

  it('declares independently deployable services and RabbitMQ infrastructure', () => {
    const compose = readFileSync(
      join(root, 'infra', 'docker-compose.yml'),
      'utf8',
    );

    expect(compose).toContain('auth-service:');
    expect(compose).toContain('seat-service:');
    expect(compose).toContain('payment-service:');
    expect(compose).toContain('api-gateway:');
    expect(compose).toContain('auth-postgres:');
    expect(compose).toContain('seat-postgres:');
    expect(compose).toContain('payment-postgres:');
    expect(compose).toContain('rabbitmq:');
    expect(compose).toContain('condition: service_healthy');
    expect(compose).not.toMatch(/^\s{2}postgres:\s*$/m);
  });

  it('declares dedicated Postgres deployments per domain service', () => {
    const compose = readFileSync(
      join(root, 'infra', 'docker-compose.yml'),
      'utf8',
    );
    const databases = [
      { service: 'auth-postgres', db: 'auth' },
      { service: 'seat-postgres', db: 'seat' },
      { service: 'payment-postgres', db: 'payment' },
    ];

    for (const database of databases) {
      const block = serviceBlock(compose, database.service);

      expect(block).toContain('image: postgres:16-alpine');
      expect(block).toContain(`POSTGRES_DB: ${database.db}`);
      expect(block).toContain(`POSTGRES_USER: ${database.db}`);
      expect(block).toContain(`POSTGRES_PASSWORD: ${database.db}`);
      expect(block).toContain(
        `${database.service}-data:/var/lib/postgresql/data`,
      );
      expect(block).toContain(
        `./postgres/${database.db}/migrations:/docker-entrypoint-initdb.d:ro`,
      );
      expect(block).toContain(`pg_isready -U ${database.db} -d ${database.db}`);
      expect(compose).toContain(`${database.service}-data:`);
    }
  });

  it('wires each service to only its own database and keeps the gateway DB-free', () => {
    const compose = readFileSync(
      join(root, 'infra', 'docker-compose.yml'),
      'utf8',
    );
    const services = [
      {
        service: 'auth-service',
        databaseService: 'auth-postgres',
        databaseUrl: '@auth-postgres:5432/auth',
        otherDatabaseServices: ['seat-postgres', 'payment-postgres'],
      },
      {
        service: 'seat-service',
        databaseService: 'seat-postgres',
        databaseUrl: '@seat-postgres:5432/seat',
        otherDatabaseServices: ['auth-postgres', 'payment-postgres'],
      },
      {
        service: 'payment-service',
        databaseService: 'payment-postgres',
        databaseUrl: '@payment-postgres:5432/payment',
        otherDatabaseServices: ['auth-postgres', 'seat-postgres'],
      },
    ];

    for (const service of services) {
      const block = serviceBlock(compose, service.service);

      expect(block).toContain('DATABASE_URL:');
      expect(block).toContain(service.databaseUrl);
      expect(block).toContain(`${service.databaseService}:`);
      for (const otherDatabaseService of service.otherDatabaseServices) {
        expect(block).not.toContain(`${otherDatabaseService}:`);
        expect(block).not.toContain(`@${otherDatabaseService}:`);
      }
    }

    const gatewayBlock = serviceBlock(compose, 'api-gateway');
    expect(gatewayBlock).not.toContain('DATABASE_URL');
    expect(gatewayBlock).not.toContain('postgres');
    expect(compose).not.toContain(
      'postgres://reservation:reservation@postgres:5432/reservation',
    );
  });

  it('keeps migrations scoped to the owning service database', () => {
    expect(
      existsSync(join(root, 'infra', 'postgres', 'migrations', '001_init.sql')),
    ).toBe(false);

    const authMigration = readMigration('auth');
    const seatMigration = readMigration('seat');
    const paymentMigration = readMigration('payment');

    expect(authMigration).toContain('CREATE SCHEMA IF NOT EXISTS auth');
    expect(authMigration).toContain('auth.users');
    expect(authMigration).toContain('auth.refresh_tokens');
    expect(authMigration).not.toMatch(/\b(seat|payment|eventing)\./);

    expect(seatMigration).toContain('CREATE SCHEMA IF NOT EXISTS seat');
    expect(seatMigration).toContain('CREATE SCHEMA IF NOT EXISTS eventing');
    expect(seatMigration).toContain('seat.seats');
    expect(seatMigration).toContain('seat.reservations');
    expect(seatMigration).toContain('eventing.outbox');
    expect(seatMigration).toContain('eventing.inbox');
    expect(seatMigration).toContain("producer = 'seat-service'");
    expect(seatMigration).not.toMatch(/\b(auth|payment)\./);

    expect(paymentMigration).toContain('CREATE SCHEMA IF NOT EXISTS payment');
    expect(paymentMigration).toContain('CREATE SCHEMA IF NOT EXISTS eventing');
    expect(paymentMigration).toContain('payment.payments');
    expect(paymentMigration).toContain('payment.webhook_events');
    expect(paymentMigration).toContain('eventing.outbox');
    expect(paymentMigration).toContain('eventing.inbox');
    expect(paymentMigration).toContain("producer = 'payment-service'");
    expect(paymentMigration).not.toMatch(/\b(auth|seat)\./);
  });

  it('creates Postgres invariants for seat concurrency and idempotency', () => {
    const seatMigration = readMigration('seat');
    const paymentMigration = readMigration('payment');
    const seatService = readFileSync(
      join(root, 'apps', 'seat-service', 'src', 'seats.service.ts'),
      'utf8',
    );

    expect(seatMigration).toContain('reservations_one_active_per_seat');
    expect(seatMigration).toContain('reservations_one_active_hold_per_user');
    expect(seatService).toContain('FOR UPDATE SKIP LOCKED');
    expect(seatMigration).toContain('eventing.inbox');
    expect(paymentMigration).toContain('eventing.inbox');
    expect(paymentMigration).toContain('payment.webhook_events');
  });
});

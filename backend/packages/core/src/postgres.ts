import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { numberEnv, optionalEnv, requireEnv } from './config';

export type DbClient = Pool | PoolClient;

@Injectable()
export class PostgresService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const serviceName = optionalEnv('SERVICE_NAME', 'reservation-service');
    this.pool = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      max: numberEnv('PG_POOL_MAX', 10),
      idleTimeoutMillis: numberEnv('PG_IDLE_TIMEOUT_MS', 30000),
      connectionTimeoutMillis: numberEnv('PG_CONNECTION_TIMEOUT_MS', 5000),
      application_name: serviceName,
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return await this.pool.query<T>(text, values);
  }

  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ready(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

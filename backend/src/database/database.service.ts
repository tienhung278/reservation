import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import * as schema from './schema';

const DEFAULT_DATABASE_PATH = join(
  process.cwd(),
  '.data',
  'reservation.sqlite',
);

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly path: string;
  private readonly database: DatabaseSync;
  private readonly drizzleClient: SqliteRemoteDatabase<typeof schema>;
  private readonly transactionContext = new AsyncLocalStorage<boolean>();
  private transactionLock?: Promise<void>;
  private closed = false;

  constructor() {
    this.path = resolveDatabasePath();

    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    this.database = new DatabaseSync(this.path);
    this.drizzleClient = drizzle(createProxyCallback(this.database), {
      schema,
    });
    this.configure();
    this.initializeSchema();
  }

  get connection(): DatabaseSync {
    return this.database;
  }

  get db(): SqliteRemoteDatabase<typeof schema> {
    return this.drizzleClient;
  }

  transaction<T>(operation: () => Promise<T>): Promise<T>;
  transaction<T>(operation: () => T): T;
  transaction<T>(operation: () => T | Promise<T>): T | Promise<T> {
    if (this.transactionContext.getStore()) {
      return operation();
    }

    return this.runExclusiveTransaction(() =>
      this.runManualTransaction(operation),
    );
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.database.close();
    this.closed = true;
  }

  onModuleDestroy(): void {
    this.close();
  }

  private configure(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS seats (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        seat_id TEXT NOT NULL REFERENCES seats(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending_payment', 'reserved', 'expired')
        ),
        payment_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        reserved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'succeeded', 'expired')
        ),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_seat
        ON reservations(seat_id)
        WHERE status IN ('pending_payment', 'reserved');

      INSERT INTO seats (id, label)
      VALUES
        ('seat-1', 'Seat 1'),
        ('seat-2', 'Seat 2'),
        ('seat-3', 'Seat 3')
      ON CONFLICT(id) DO UPDATE SET label = excluded.label;
    `);
  }

  private runExclusiveTransaction<T>(
    operation: () => T | Promise<T>,
  ): T | Promise<T> {
    const previous = this.transactionLock;
    let release!: () => void;
    this.transactionLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.transactionLock;

    const finish = () => {
      release();
      if (this.transactionLock === current) {
        this.transactionLock = undefined;
      }
    };

    const run = () => {
      try {
        const result = operation();
        if (isPromiseLike(result)) {
          return result.finally(finish);
        }

        finish();
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    };

    if (previous) {
      return previous.then(run);
    }

    return run();
  }

  private runManualTransaction<T>(
    operation: () => T | Promise<T>,
  ): T | Promise<T> {
    this.database.exec('BEGIN IMMEDIATE');

    return this.transactionContext.run(true, () => {
      try {
        const result = operation();

        if (isPromiseLike(result)) {
          return result.then(
            (value) => {
              this.database.exec('COMMIT');
              return value;
            },
            (error) => {
              this.database.exec('ROLLBACK');
              throw error;
            },
          );
        }

        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    });
  }
}

function resolveDatabasePath(): string {
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }

  const configuredPath = process.env.RESERVATION_DB_PATH?.trim();
  return configuredPath || DEFAULT_DATABASE_PATH;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as Promise<T>).then === 'function'
  );
}

function createProxyCallback(database: DatabaseSync) {
  return (
    sql: string,
    params: unknown[],
    method: 'run' | 'all' | 'values' | 'get',
  ) => {
    const statement = database.prepare(sql);
    const values = params as SQLInputValue[];

    if (method === 'run') {
      statement.run(...values);
      return Promise.resolve({ rows: [] });
    }

    if (method === 'get') {
      const row = statement.get(...values) as
        | Record<string, unknown>
        | undefined;

      return Promise.resolve({
        rows: row ? Object.values(row) : (undefined as unknown as unknown[]),
      });
    }

    const rows = statement.all(...values) as Record<string, unknown>[];

    return Promise.resolve({
      rows: rows.map((row) => Object.values(row)),
    });
  };
}

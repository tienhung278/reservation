import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbClient, PostgresService } from '../../../packages/core/src/postgres';

export interface AuthUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  tokenVersion: number;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  rotatedToTokenId: string | null;
  revokedAt: Date | null;
  graceUntil: Date | null;
  expiresAt: Date;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  rotated_to_token_id: string | null;
  revoked_at: Date | null;
  grace_until: Date | null;
  expires_at: Date;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly postgres: PostgresService) {}

  async findUserByUsername(
    username: string,
  ): Promise<AuthUserRecord | undefined> {
    const result = await this.postgres.query<{
      id: string;
      username: string;
      password_hash: string;
      token_version: number;
    }>(
      `
        SELECT id, username, password_hash, token_version
        FROM auth.users
        WHERE lower(username) = lower($1)
      `,
      [username],
    );

    return result.rows[0] ? toUser(result.rows[0]) : undefined;
  }

  async findUserById(
    userId: string,
    client?: DbClient,
  ): Promise<AuthUserRecord | undefined> {
    const db = client ?? this.postgres.pool;
    const result = await db.query<{
      id: string;
      username: string;
      password_hash: string;
      token_version: number;
    }>(
      `
        SELECT id, username, password_hash, token_version
        FROM auth.users
        WHERE id = $1
      `,
      [userId],
    );

    return result.rows[0] ? toUser(result.rows[0]) : undefined;
  }

  async upsertDemoUser(input: {
    username: string;
    passwordHash: string;
  }): Promise<void> {
    await this.postgres.query(
      `
        INSERT INTO auth.users (id, username, password_hash)
        VALUES ($1, $2, $3)
        ON CONFLICT ((lower(username))) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            updated_at = now()
      `,
      [randomUUID(), input.username, input.passwordHash],
    );
  }

  async createRefreshToken(input: {
    client?: DbClient;
    id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<void> {
    const client = input.client ?? this.postgres.pool;
    await client.query(
      `
        INSERT INTO auth.refresh_tokens (
          id, user_id, token_hash, family_id, expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        input.id,
        input.userId,
        input.tokenHash,
        input.familyId,
        input.expiresAt,
      ],
    );
  }

  async findRefreshTokenByHash(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined> {
    return await this.findRefreshTokenByHashUsing({
      tokenHash,
      client: this.postgres.pool,
      lock: false,
    });
  }

  async findRefreshTokenByHashForUpdate(input: {
    client: DbClient;
    tokenHash: string;
  }): Promise<RefreshTokenRecord | undefined> {
    return await this.findRefreshTokenByHashUsing({
      tokenHash: input.tokenHash,
      client: input.client,
      lock: true,
    });
  }

  private async findRefreshTokenByHashUsing(input: {
    client: DbClient;
    tokenHash: string;
    lock: boolean;
  }): Promise<RefreshTokenRecord | undefined> {
    const result = await input.client.query<RefreshTokenRow>(
      `
        SELECT id, user_id, token_hash, family_id, rotated_to_token_id,
               revoked_at, grace_until, expires_at
        FROM auth.refresh_tokens
        WHERE token_hash = $1
        ${input.lock ? 'FOR UPDATE' : ''}
      `,
      [input.tokenHash],
    );

    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          tokenHash: row.token_hash,
          familyId: row.family_id,
          rotatedToTokenId: row.rotated_to_token_id,
          revokedAt: row.revoked_at,
          graceUntil: row.grace_until,
          expiresAt: row.expires_at,
        }
      : undefined;
  }

  async rotateRefreshToken(input: {
    oldTokenId: string;
    newTokenId: string;
    graceUntil: Date;
    client: DbClient;
  }): Promise<boolean> {
    const result = await input.client.query(
      `
        UPDATE auth.refresh_tokens
        SET revoked_at = COALESCE(revoked_at, now()),
            rotated_to_token_id = $2,
            grace_until = $3
        WHERE id = $1
          AND rotated_to_token_id IS NULL
        RETURNING id
      `,
      [input.oldTokenId, input.newTokenId, input.graceUntil],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async revokeRefreshTokenFamily(input: {
    familyId: string;
    client?: DbClient;
  }): Promise<void> {
    const client = input.client ?? this.postgres.pool;
    await client.query(
      `
        UPDATE auth.refresh_tokens
        SET revoked_at = COALESCE(revoked_at, now()),
            grace_until = NULL
        WHERE family_id = $1
      `,
      [input.familyId],
    );
  }

  async revokeAllRefreshTokensForUser(input: {
    userId: string;
    client?: DbClient;
  }): Promise<void> {
    const client = input.client ?? this.postgres.pool;
    await client.query(
      `
        UPDATE auth.refresh_tokens
        SET revoked_at = COALESCE(revoked_at, now()),
            grace_until = NULL
        WHERE user_id = $1
      `,
      [input.userId],
    );
  }

  async bumpTokenVersion(input: {
    userId: string;
    client?: DbClient;
  }): Promise<number> {
    const client = input.client ?? this.postgres.pool;
    const result = await client.query<{ token_version: number }>(
      `
        UPDATE auth.users
        SET token_version = token_version + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING token_version
      `,
      [input.userId],
    );

    return result.rows[0]?.token_version ?? 0;
  }

  async insertAudit(input: {
    client?: DbClient;
    userId?: string;
    action: string;
    traceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const client = input.client ?? this.postgres.pool;
    await client.query(
      `
        INSERT INTO auth.audit_logs (id, user_id, action, trace_id, metadata)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        randomUUID(),
        input.userId ?? null,
        input.action,
        input.traceId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}

function toUser(row: {
  id: string;
  username: string;
  password_hash: string;
  token_version: number;
}): AuthUserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    tokenVersion: row.token_version,
  };
}

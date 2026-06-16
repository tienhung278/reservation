CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
  ON auth.users ((lower(username)));

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  rotated_to_token_id uuid,
  revoked_at timestamptz,
  grace_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx
  ON auth.refresh_tokens (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth.audit_logs (
  id uuid PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  trace_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_action_idx
  ON auth.audit_logs (user_id, action, created_at DESC);

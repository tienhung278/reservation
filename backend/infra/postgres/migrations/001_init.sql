CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS seat;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS eventing;

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

CREATE TABLE IF NOT EXISTS seat.seats (
  id text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS seat.reservations (
  id uuid PRIMARY KEY,
  seat_id text NOT NULL REFERENCES seat.seats(id),
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_payment', 'reserved', 'expired')),
  payment_id uuid NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz,
  released_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_seat
  ON seat.reservations (seat_id)
  WHERE status IN ('pending_payment', 'reserved');

CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_hold_per_user
  ON seat.reservations (user_id)
  WHERE status = 'pending_payment';

CREATE INDEX IF NOT EXISTS reservations_pending_expiry_idx
  ON seat.reservations (expires_at)
  WHERE status = 'pending_payment';

CREATE TABLE IF NOT EXISTS payment.payments (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL UNIQUE,
  seat_id text NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS payments_pending_expiry_idx
  ON payment.payments (expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS payment.webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eventing.outbox (
  id uuid PRIMARY KEY,
  producer text NOT NULL CHECK (producer IN ('auth-service', 'seat-service', 'payment-service')),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  routing_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'published', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON eventing.outbox (producer, available_at, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS eventing.inbox (
  event_id uuid NOT NULL,
  consumer text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

INSERT INTO seat.seats (id, label)
VALUES
  ('seat-1', 'Seat 1'),
  ('seat-2', 'Seat 2'),
  ('seat-3', 'Seat 3')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;


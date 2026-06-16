CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS eventing;

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
  producer text NOT NULL CHECK (producer = 'payment-service'),
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

CREATE SCHEMA IF NOT EXISTS seat;
CREATE SCHEMA IF NOT EXISTS eventing;

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

CREATE TABLE IF NOT EXISTS eventing.outbox (
  id uuid PRIMARY KEY,
  producer text NOT NULL CHECK (producer = 'seat-service'),
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

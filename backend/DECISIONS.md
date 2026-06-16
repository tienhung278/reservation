# Backend Decisions

## 1. Microservice Boundary

Auth, seat-reservation, payment, and gateway are separate NestJS applications under `apps/`. Auth is CPU-sensitive because Argon2id work can spike CPU; seat reservation is database-contention sensitive; payment is I/O and webhook driven. They can scale independently and each has its own Dockerfile and health endpoints.

## 2. Gateway Compatibility

The frontend already expects a single `/api/*` origin. The gateway preserves those routes and performs synchronous client orchestration only at the edge. Services do not import one another's source code; shared types and utilities live under `packages/`.

## 3. Postgres Ownership

Each domain service has a dedicated Postgres deployment in local Compose: `auth-postgres`, `seat-postgres`, and `payment-postgres`. The services still use schema-qualified names (`auth.*`, `seat.*`, `payment.*`) inside their own databases so ownership stays visible without rewriting repository SQL. The gateway remains database-free.

`eventing.*` is local infrastructure inside event-driven service databases. Seat and payment each keep their own `eventing.outbox` and `eventing.inbox`, so business updates, outbox appends, and consumer idempotency records commit atomically with that service's domain tables. Auth currently has no RabbitMQ/outbox tables.

## 4. Seat Locking Strategy

Seat hold creation locks the seat row with `FOR UPDATE` and relies on partial unique indexes for the real invariant. The lock gives a clear contention point; the unique indexes protect correctness if another code path attempts to bypass application checks. Conflicts return `409` with `Retry-After`.

## 5. Hold Expiry

Expired holds are cleaned by both lazy reads and a background sweeper. The sweeper uses `LIMIT` plus `FOR UPDATE SKIP LOCKED` so multiple replicas can run without locking the whole reservation table. This is safe with PgBouncer-style pooling because no advisory-lock session affinity is required.

## 6. RabbitMQ And Outbox

RabbitMQ carries payment-to-seat and seat-to-payment events. Business updates append outbox rows in the same Postgres transaction. A publisher loop sends pending rows to RabbitMQ and marks them published. Consumers record `(event_id, consumer)` before side effects, so duplicate deliveries are no-ops.

## 7. Refresh Token Model

Access tokens are JWTs with a configurable TTL capped operationally at fifteen minutes by `.env.example`. Refresh tokens are random opaque values stored only as SHA-256 hashes. Rotation revokes the old token, links it to the successor, and keeps a short grace window for retrying clients. Reuse outside the grace window revokes the family and bumps `tokenVersion`.

## 8. Mock Payment Boundary

The service keeps a mock Stripe-style adapter rather than depending on live Stripe credentials. Amount and currency are copied from the reservation-held event into `payment.payments`, so the client cannot override price. Webhooks still require HMAC-SHA256 signatures and timestamp freshness.

## 9. Production TODOs

`TODO(prod)` comments remain at intentional scale boundaries: Redis-backed rate limits, Redis pub/sub fan-out for SSE, prom-client metrics, and a real PSP client. They mark known production paths rather than hidden omissions.

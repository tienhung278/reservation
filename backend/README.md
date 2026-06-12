# Seat Reservation Service

A small NestJS seat reservation platform. It exposes JSON APIs for service metadata, demo login, seat listing, seat selection, mock payment completion, and final reservation.

## Setup

```bash
npm install
npm run start:dev
```

The app listens on `PORT` or `3000` by default. It is API-only; use HTTP clients such as `curl`, Postman, or automated tests to call the endpoints.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `DEMO_USERNAME` | `demo@example.com` | Demo login username. |
| `DEMO_PASSWORD` | `password` | Demo login password. |
| `RESERVATION_DB_PATH` | `.data/reservation.sqlite` | SQLite database file path outside tests. |

Runtime state is stored in SQLite. The app creates the schema and seeds the three demo seats idempotently on startup. Under Jest (`NODE_ENV=test`), each app or service instance uses a fresh in-memory SQLite database (`:memory:`), so unit and e2e tests do not share state or write local database files.

Sessions are stored in SQLite and returned as a `reservation_session` HTTP-only cookie with `SameSite=Lax`, `Path=/`, and a 90 day `Max-Age`.

## API

- `GET /` returns JSON service metadata and available endpoint hints.
- `GET /api/seats` returns exactly 3 seats with `available`, `status`, and optional `reservationId`.
- `GET /api/seats/:seatId` returns one seat with `available`, `status`, and optional `reservationId`.
- `POST /api/auth/login` with `{ "username": "...", "password": "..." }` creates a session cookie.
- `GET /api/auth/session` returns the current authenticated user or `{ "authenticated": false }`.
- `POST /api/auth/logout` clears the session cookie.
- `POST /api/reservations/select` with `{ "seatId": "seat-1" }` requires auth, holds the seat, creates a pending reservation, and creates a pending payment.
- `POST /api/payments/:paymentId/complete` requires auth, marks the payment successful, and reserves the seat.

## Feature Flow Diagrams

The diagrams use Mermaid syntax, which renders in GitHub and many Markdown viewers.

### Service Metadata

```mermaid
flowchart TD
  A[Client calls GET /] --> B[AppController.getHome]
  B --> C[Build service metadata]
  C --> D[Return service name, ok status, and endpoint hints]
```

### Demo Login

```mermaid
flowchart TD
  A[Client posts username and password] --> B[AuthController.login]
  B --> C[AuthService validates request body]
  C -->|Missing or invalid fields| D[Return 422]
  C --> E[Compare with DEMO_USERNAME and DEMO_PASSWORD]
  E -->|Credentials do not match| F[Return 401]
  E -->|Credentials match| G[Create session with 90 day expiry]
  G --> H[Persist session in SQLite]
  H --> I[Set reservation_session HTTP-only cookie]
  I --> J[Return user and expiresAt]
```

### Read Current Session

```mermaid
flowchart TD
  A[Client calls GET /api/auth/session] --> B[AuthController.current]
  B --> C[AuthService reads reservation_session cookie]
  C -->|No cookie| D[Return authenticated false]
  C --> E[Find session in SQLite]
  E -->|Missing session| D
  E --> F[Check session expiry]
  F -->|Expired| G[Delete expired session]
  G --> D
  F -->|Valid| H[Return authenticated true, user, and expiresAt]
```

### Logout

```mermaid
flowchart TD
  A[Client posts POST /api/auth/logout] --> B[AuthController.logout]
  B --> C[AuthService reads reservation_session cookie]
  C -->|Cookie exists| D[Delete session from SQLite]
  C -->|No cookie| E[Skip delete]
  D --> F[Set expired reservation_session cookie]
  E --> F
  F --> G[Return ok true]
```

### List Seats

```mermaid
flowchart TD
  A[Client calls GET /api/seats] --> B[SeatsController.list]
  B --> C[SeatsService runs before-access cleanup]
  C --> D[Expire pending reservations and payments past expiresAt]
  D --> E[Query all seats with active pending or reserved reservations]
  E --> F[Map reservation status to seat status]
  F --> G[Return seats array]
```

### Get One Seat

```mermaid
flowchart TD
  A[Client calls GET /api/seats/:seatId] --> B[SeatsController.get]
  B --> C[SeatsService runs before-access cleanup]
  C --> D[Expire pending reservations and payments past expiresAt]
  D --> E[Query requested seat with active reservation]
  E -->|Seat missing| F[Return 404]
  E -->|Seat found| G[Map reservation status to seat status]
  G --> H[Return seat]
```

### Select Seat

```mermaid
flowchart TD
  A[Client posts POST /api/reservations/select] --> B[AuthenticatedUserInterceptor]
  B --> C[AuthService requires valid session]
  C -->|No valid session| D[Return 401]
  C --> E[ReservationsController.select]
  E --> F[ReservationsService validates seatId]
  F -->|Missing or invalid seatId| G[Return 422]
  F --> H[Start SQLite transaction]
  H --> I[Expire pending reservations and payments past expiresAt]
  I --> J[Ensure seat exists]
  J -->|Seat missing| K[Return 404]
  J --> L[Check active reservation for seat]
  L -->|Pending or reserved reservation exists| M[Return 409]
  L --> N[Create pending reservation and pending payment]
  N --> O[Persist both records]
  O -->|Unique active seat constraint fails| M
  O --> P[Commit transaction]
  P --> Q[Return reservation and payment]
```

### Complete Payment

```mermaid
flowchart TD
  A[Client posts POST /api/payments/:paymentId/complete] --> B[AuthenticatedUserInterceptor]
  B --> C[AuthService requires valid session]
  C -->|No valid session| D[Return 401]
  C --> E[PaymentsController.complete]
  E --> F[PaymentsService starts transaction]
  F --> G[Find payment by paymentId]
  G -->|Missing or belongs to another user| H[Return 404]
  G --> I[Check payment status]
  I -->|Already expired| J[Return 409 Payment has expired]
  I -->|Not pending| K[Return 409 Payment is already completed]
  I -->|Pending but expiresAt has passed| L[Mark payment expired]
  L --> M[Expire matching reservation]
  M --> J
  I -->|Pending and not expired| N[Finalize reservation for payment]
  N --> O[Load reservation and verify same user]
  O -->|Missing or wrong user| H
  O --> P[Require reservation status pending_payment]
  P -->|Already completed or expired| Q[Return 409]
  P --> R[Verify no other active reservation owns the seat]
  R -->|Seat is not available| S[Return 409]
  R --> T[Mark reservation reserved]
  T --> U[Mark payment succeeded]
  U --> V[Commit transaction]
  V --> W[Return payment and reservation]
```

### Lazy Expiration Cleanup

```mermaid
flowchart TD
  A[Seat read or seat selection starts] --> B[Cleanup runs inside service flow]
  B --> C[Find pending reservations where expiresAt is in the past]
  C --> D[Mark matching reservations expired]
  D --> E[Mark matching payments expired]
  E --> F[Expired seats become available on subsequent reads]
```

## Assumptions And Trade-Offs

- SQLite is used for local durable runtime state without adding an npm database dependency. The default `.data/` directory is ignored by git.
- A pending reservation makes the seat unavailable immediately. This prevents double reservation while mock payment is incomplete.
- Pending reservations and payments expire after 1 hour. Expired pending reservations release their seat lazily during seat reads and new seat-selection attempts.
- Authentication is demo credential based and should be replaced with a real identity provider before production use.
- Controllers delegate business rules to services. Feature modules are split by auth, seats, reservations, payments, and shared cookie helpers so storage and workflow logic can be extended independently.
- DTO validation is explicit and local because no validation dependency is installed.

## Failure Cases

- Unauthenticated selection and payment completion return `401`.
- Invalid credentials return `401`.
- Missing or non-string `seatId` returns `422`.
- Unknown seats, payments, or reservations return `404`.
- Selecting a pending or reserved seat returns `409`.
- Completing an already completed payment returns `409`.
- Completing another user's payment is hidden as `404`.

## Operational Concerns

- The local SQLite database is suitable for single-process development and assessment runtime. Use a production database before scaling horizontally across multiple Node processes.
- Session secrets are not needed for the current random opaque session IDs, but a persistent session store should be used for production.
- Seat hold creation and payment completion use SQLite transactions. Active reservations are protected by a partial unique index on pending and reserved reservations per seat.
- Observability is currently limited to Nest defaults. Add structured logs and metrics around login attempts, seat selection conflicts, and payment completion failures.

## Extension Paths

- Replace local SQLite with repository interfaces backed by Postgres or another transactional database.
- Add background cleanup for old expired reservations and payments if local database files are kept long term.
- Add real users, authorization boundaries, and password hashing or SSO.
- Add real payment provider integration behind the existing payment service boundary.
- Add admin APIs for seat inventory management.

## Checks

```bash
npm test
npm run test:e2e
npm run lint
npm run build
```

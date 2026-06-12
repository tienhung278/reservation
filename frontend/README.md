# Reservation Frontend

Next.js web app for the reservation API in `../backend`. The app lets a demo user sign in, view seat availability, create one pending checkout, complete the mock payment, and see the reserved seat state.

## Setup

Install dependencies:

```bash
npm install
```

Start the backend first from `../backend`:

```bash
npm run start:dev
```

The backend defaults to `http://localhost:3000`.

Start the frontend from this directory:

```bash
npm run dev
```

The frontend runs on `http://localhost:3001` so it does not conflict with the backend. Browser requests to `/api/*` are proxied to the backend by `next.config.ts`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESERVATION_API_ORIGIN` | `http://localhost:3000` | Backend origin used by the Next.js rewrite for `/api/*`. |

Demo credentials are controlled by the backend. With backend defaults, use:

- Email: `demo@example.com`
- Password: `password`

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Frontend Structure

- `app/page.tsx` is the route entry point.
- `components/reservation/` contains presentational UI components.
- `hooks/useReservationDesk.ts` owns reservation screen state and user actions.
- `lib/reservation/api.ts` wraps backend API calls.
- `lib/reservation/checkout.ts` contains checkout restoration rules.
- `lib/reservation/storage.ts` persists the current pending checkout in `localStorage`.
- `lib/reservation/types.ts` contains shared frontend API/domain types.
- `lib/reservation/format.ts` contains display formatting and status styles.

## Behavior Notes

- The session is stored by the backend as an HTTP-only cookie.
- The frontend never stores credentials or session tokens.
- A pending checkout is stored in `localStorage` only so the user can refresh the page and still complete the current payment.
- Stored checkout state is restored only when the authenticated session and current seat list still match the pending reservation.
- The app does not expose cancellation, reservation history, user management, or real payment methods because those endpoints do not exist in the backend API.

## Checks

Run before handing off frontend changes:

```bash
npm run lint
npm run build
```

For a manual smoke test:

1. Start the backend on `3000`.
2. Start the frontend on `3001`.
3. Open `http://localhost:3001`.
4. Log in with the demo credentials.
5. Select an available seat.
6. Refresh and verify the pending checkout remains available.
7. Complete the payment and verify the seat becomes reserved.
8. Log out and verify the session panel returns to signed out.

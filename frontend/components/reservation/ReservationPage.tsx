"use client";

import { CheckoutPanel } from "@/components/reservation/CheckoutPanel";
import { ErrorBanner } from "@/components/reservation/ErrorBanner";
import { SeatGrid } from "@/components/reservation/SeatGrid";
import { SessionPanel } from "@/components/reservation/SessionPanel";
import { useReservationDesk } from "@/hooks/useReservationDesk";

export function ReservationPage() {
  const reservation = useReservationDesk();

  return (
    <main className="min-h-screen bg-[#f7f4ee] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">
              Reservation desk
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-950 sm:text-4xl">
              Select and reserve a seat
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700">
              {reservation.availableCount} available
            </span>
            <button
              className="rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={reservation.seatsLoading}
              onClick={() => void reservation.loadSeats()}
              type="button"
            >
              {reservation.seatsLoading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </header>

        <ErrorBanner error={reservation.error} />

        <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <SeatGrid
            authenticated={reservation.authenticated}
            hasPendingCheckout={reservation.hasPendingCheckout}
            onSelectSeat={reservation.handleSelectSeat}
            paymentLoading={reservation.paymentLoading}
            seats={reservation.seats}
            seatsLoading={reservation.seatsLoading}
            selectingSeatId={reservation.selectingSeatId}
          />

          <aside className="space-y-5">
            <SessionPanel
              authenticated={reservation.authenticated}
              loginLoading={reservation.loginLoading}
              logoutLoading={reservation.logoutLoading}
              onLogin={reservation.handleLogin}
              onLogout={reservation.handleLogout}
              onPasswordChange={reservation.setPassword}
              onUsernameChange={reservation.setUsername}
              password={reservation.password}
              session={reservation.session}
              sessionLoading={reservation.sessionLoading}
              username={reservation.username}
            />

            <CheckoutPanel
              canCompletePayment={reservation.canCompletePayment}
              checkout={reservation.checkout}
              currentSeat={reservation.currentSeat}
              onCompletePayment={reservation.handleCompletePayment}
              paymentLoading={reservation.paymentLoading}
              selectingSeatId={reservation.selectingSeatId}
            />
          </aside>
        </section>
      </div>
    </main>
  );
}

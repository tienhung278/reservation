import { formatDate } from "@/lib/reservation/format";
import type { Checkout, Seat } from "@/lib/reservation/types";

type CheckoutPanelProps = {
  canCompletePayment: boolean;
  checkout: Checkout | null;
  currentSeat: Seat | null | undefined;
  paymentLoading: boolean;
  selectingSeatId: string | null;
  onCompletePayment: () => void;
};

export function CheckoutPanel({
  canCompletePayment,
  checkout,
  currentSeat,
  paymentLoading,
  selectingSeatId,
  onCompletePayment,
}: CheckoutPanelProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Current checkout</h2>

      {checkout ? (
        <div className="mt-4 space-y-4">
          <dl className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Seat</dt>
              <dd className="font-semibold text-slate-900">
                {currentSeat?.label ?? checkout.reservation.seatId}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Reservation</dt>
              <dd className="text-right font-semibold text-slate-900">
                {checkout.reservation.status}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Payment</dt>
              <dd className="text-right font-semibold text-slate-900">
                {checkout.payment.status}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Payment ID</dt>
              <dd className="max-w-44 break-words text-right font-mono text-xs text-slate-900">
                {checkout.payment.id}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Expires</dt>
              <dd className="text-right text-slate-900">
                {formatDate(checkout.payment.expiresAt ?? checkout.reservation.expiresAt)}
              </dd>
            </div>
          </dl>

          <button
            className="w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canCompletePayment || paymentLoading || Boolean(selectingSeatId)}
            onClick={() => void onCompletePayment()}
            type="button"
          >
            {paymentLoading
              ? "Completing"
              : checkout.payment.status === "pending"
                ? "Complete payment"
                : "Payment completed"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Select an available seat to create a pending reservation and payment.
        </p>
      )}
    </section>
  );
}

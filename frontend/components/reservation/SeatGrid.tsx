import { SeatCard } from "@/components/reservation/SeatCard";
import { statusDotClass } from "@/lib/reservation/format";
import type { Seat, SeatStatus } from "@/lib/reservation/types";

type SeatGridProps = {
  authenticated: boolean;
  hasPendingCheckout: boolean;
  paymentLoading: boolean;
  seats: Seat[];
  seatsLoading: boolean;
  selectingSeatId: string | null;
  onSelectSeat: (seat: Seat) => void;
};

export function SeatGrid({
  authenticated,
  hasPendingCheckout,
  paymentLoading,
  seats,
  seatsLoading,
  selectingSeatId,
  onSelectSeat,
}: SeatGridProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Seats</h2>
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-700">
          {(["available", "pending", "reserved"] as SeatStatus[]).map((status) => (
            <span
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1"
              key={status}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status)}`} />
              {status}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {seats.map((seat) => (
          <SeatCard
            authenticated={authenticated}
            hasPendingCheckout={hasPendingCheckout}
            key={seat.id}
            onSelectSeat={onSelectSeat}
            paymentLoading={paymentLoading}
            seat={seat}
            selectingSeatId={selectingSeatId}
          />
        ))}
      </div>

      {!seatsLoading && seats.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          No seats were returned by the API.
        </div>
      ) : null}
    </div>
  );
}

import { statusClass, statusDotClass } from "@/lib/reservation/format";
import type { Seat } from "@/lib/reservation/types";

type SeatCardProps = {
  authenticated: boolean;
  hasPendingCheckout: boolean;
  paymentLoading: boolean;
  seat: Seat;
  selectingSeatId: string | null;
  onSelectSeat: (seat: Seat) => void;
};

export function SeatCard({
  authenticated,
  hasPendingCheckout,
  paymentLoading,
  seat,
  selectingSeatId,
  onSelectSeat,
}: SeatCardProps) {
  const isAvailable = seat.status === "available";
  const isSelecting = selectingSeatId === seat.id;
  const isSeatActionable =
    authenticated &&
    isAvailable &&
    !hasPendingCheckout &&
    !selectingSeatId &&
    !paymentLoading;

  return (
    <button
      className={`min-h-44 rounded-lg border p-5 text-left shadow-sm transition ${statusClass(seat.status)} ${
        isSeatActionable
          ? "hover:-translate-y-0.5 hover:shadow-md"
          : "cursor-not-allowed opacity-75"
      } disabled:cursor-not-allowed disabled:opacity-60`}
      disabled={!isSeatActionable}
      onClick={() => void onSelectSeat(seat)}
      type="button"
    >
      <span className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-2xl font-semibold">{seat.label}</span>
          <span className="mt-2 block text-sm capitalize">{seat.status}</span>
        </span>
        <span className={`mt-1 h-3 w-3 rounded-full ${statusDotClass(seat.status)}`} />
      </span>

      <span className="mt-8 block text-sm font-semibold">
        {!authenticated
          ? "Log in to select"
          : isSelecting
            ? "Selecting"
            : hasPendingCheckout && isAvailable
              ? "Complete current payment"
              : isAvailable
                ? "Select seat"
                : "Unavailable"}
      </span>
    </button>
  );
}

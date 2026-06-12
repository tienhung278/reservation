import type { Checkout, Seat, SessionResponse } from "@/lib/reservation/types";

export function isPendingCheckout(checkout: Checkout | null) {
  return (
    checkout?.payment.status === "pending" ||
    checkout?.reservation.status === "pending_payment" ||
    checkout?.reservation.status === "pending"
  );
}

export function isCheckoutForSession(checkout: Checkout, session: SessionResponse) {
  const sessionUserId = session.user?.id;
  const checkoutUserId = checkout.reservation.userId ?? checkout.payment.userId;

  return !sessionUserId || !checkoutUserId || sessionUserId === checkoutUserId;
}

export function findRestorableCheckout(
  checkout: Checkout | null,
  session: SessionResponse,
  seats: Seat[],
) {
  if (!checkout || !session.authenticated || !isPendingCheckout(checkout)) {
    return null;
  }

  if (!isCheckoutForSession(checkout, session)) {
    return null;
  }

  const seat = seats.find((item) => item.id === checkout.reservation.seatId);

  if (!seat || seat.status !== "pending") {
    return null;
  }

  if (seat.reservationId && seat.reservationId !== checkout.reservation.id) {
    return null;
  }

  return checkout;
}

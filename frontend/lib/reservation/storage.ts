import { isPendingCheckout } from "@/lib/reservation/checkout";
import type { Checkout } from "@/lib/reservation/types";

export const checkoutStorageKey = "reservation.currentCheckout.v1";

export function readStoredCheckout() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(checkoutStorageKey);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<Checkout>;

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.reservation &&
      parsed.payment &&
      typeof parsed.reservation.id === "string" &&
      typeof parsed.reservation.seatId === "string" &&
      typeof parsed.reservation.status === "string" &&
      typeof parsed.payment.id === "string" &&
      typeof parsed.payment.status === "string"
    ) {
      return parsed as Checkout;
    }
  } catch {
    return null;
  }

  return null;
}

export function storeCheckout(checkout: Checkout) {
  if (typeof window === "undefined") {
    return;
  }

  if (!isPendingCheckout(checkout)) {
    window.localStorage.removeItem(checkoutStorageKey);
    return;
  }

  window.localStorage.setItem(checkoutStorageKey, JSON.stringify(checkout));
}

export function clearStoredCheckout() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(checkoutStorageKey);
  }
}

import type { Checkout, Seat, SessionResponse } from "@/lib/reservation/types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  let body: unknown = null;
  const text = await response.text();

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new ApiError(extractErrorMessage(body, response.statusText), response.status);
  }

  return body as T;
}

function extractErrorMessage(body: unknown, fallback: string) {
  if (typeof body === "string" && body.trim()) {
    return body;
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message;

    if (Array.isArray(message) && message.length > 0) {
      return message.join(", ");
    }

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
  }

  return fallback || "Request failed";
}

export function getSession() {
  return apiFetch<SessionResponse>("/api/auth/session");
}

export function login(username: string, password: string) {
  return apiFetch<SessionResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return apiFetch<unknown>("/api/auth/logout", { method: "POST" });
}

export function getSeats() {
  return apiFetch<{ seats: Seat[] }>("/api/seats");
}

export function selectSeat(seatId: string) {
  return apiFetch<Checkout>("/api/reservations/select", {
    method: "POST",
    body: JSON.stringify({ seatId }),
  });
}

export function completePayment(paymentId: string) {
  return apiFetch<Checkout>(`/api/payments/${paymentId}/complete`, {
    method: "POST",
  });
}

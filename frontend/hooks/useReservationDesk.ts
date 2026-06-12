"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  completePayment,
  getSeats,
  getSession,
  login,
  logout,
  selectSeat,
} from "@/lib/reservation/api";
import { findRestorableCheckout, isPendingCheckout } from "@/lib/reservation/checkout";
import {
  clearStoredCheckout,
  readStoredCheckout,
  storeCheckout,
} from "@/lib/reservation/storage";
import type { Checkout, Seat, SessionResponse } from "@/lib/reservation/types";

const defaultLogin = {
  username: "demo@example.com",
  password: "password",
};

export function useReservationDesk() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatsLoading, setSeatsLoading] = useState(true);
  const [username, setUsername] = useState(defaultLogin.username);
  const [password, setPassword] = useState(defaultLogin.password);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [selectingSeatId, setSelectingSeatId] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authenticated = Boolean(session?.authenticated);
  const hasPendingCheckout = isPendingCheckout(checkout);
  const canCompletePayment = Boolean(
    checkout && authenticated && checkout.payment.status === "pending",
  );

  const recoverUnauthorized = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      setSession({ authenticated: false });
      setCheckout(null);
      clearStoredCheckout();
      return true;
    }

    return false;
  }, []);

  const loadSeats = useCallback(async (checkoutToReconcile: Checkout | null = checkout) => {
    setSeatsLoading(true);

    try {
      const result = await getSeats();
      setSeats(result.seats);

      if (checkoutToReconcile && isPendingCheckout(checkoutToReconcile)) {
        const sessionForReconcile = session ?? { authenticated };
        const restored = findRestorableCheckout(
          checkoutToReconcile,
          sessionForReconcile,
          result.seats,
        );

        if (!restored) {
          setCheckout(null);
          clearStoredCheckout();
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load seats");
    } finally {
      setSeatsLoading(false);
    }
  }, [authenticated, checkout, session]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [sessionResult, seatsResult] = await Promise.all([
          getSession().catch((error) => {
            if (error instanceof ApiError && error.status === 401) {
              return { authenticated: false };
            }

            throw error;
          }),
          getSeats(),
        ]);

        if (!cancelled) {
          setSession(sessionResult);
          setSeats(seatsResult.seats);

          const restoredCheckout = findRestorableCheckout(
            readStoredCheckout(),
            sessionResult,
            seatsResult.seats,
          );

          if (restoredCheckout) {
            setCheckout(restoredCheckout);
          } else {
            clearStoredCheckout();
          }
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Unable to load reservation data");
          setSession({ authenticated: false });
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
          setSeatsLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  const availableCount = useMemo(
    () => seats.filter((seat) => seat.status === "available").length,
    [seats],
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loginLoading) {
      return;
    }

    setLoginLoading(true);
    setError(null);

    try {
      await login(username, password);

      const [sessionResult, seatsResult] = await Promise.all([getSession(), getSeats()]);
      setSession(sessionResult);
      setSeats(seatsResult.seats);

      const restoredCheckout = findRestorableCheckout(
        readStoredCheckout(),
        sessionResult,
        seatsResult.seats,
      );

      if (restoredCheckout) {
        setCheckout(restoredCheckout);
      } else {
        clearStoredCheckout();
        setCheckout(null);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to log in");
      setSession({ authenticated: false });
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    if (logoutLoading) {
      return;
    }

    setLogoutLoading(true);
    setError(null);

    try {
      await logout();
      setCheckout(null);
      clearStoredCheckout();
      setSession({ authenticated: false });
      await loadSeats();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to log out");
    } finally {
      setLogoutLoading(false);
    }
  }

  async function handleSelectSeat(seat: Seat) {
    if (
      !authenticated ||
      seat.status !== "available" ||
      selectingSeatId ||
      paymentLoading ||
      hasPendingCheckout
    ) {
      return;
    }

    setSelectingSeatId(seat.id);
    setError(null);

    try {
      const result = await selectSeat(seat.id);

      setCheckout(result);
      storeCheckout(result);
      await loadSeats(result);
    } catch (error) {
      if (!recoverUnauthorized(error)) {
        setError(error instanceof Error ? error.message : "Unable to select seat");
        await loadSeats();
      }
    } finally {
      setSelectingSeatId(null);
    }
  }

  async function handleCompletePayment() {
    if (!checkout || checkout.payment.status !== "pending" || paymentLoading || selectingSeatId) {
      return;
    }

    setPaymentLoading(true);
    setError(null);

    try {
      const result = await completePayment(checkout.payment.id);

      setCheckout(result);
      clearStoredCheckout();
      await loadSeats(null);
    } catch (error) {
      if (!recoverUnauthorized(error)) {
        setError(error instanceof Error ? error.message : "Unable to complete payment");

        if (error instanceof ApiError && [404, 409, 422].includes(error.status)) {
          setCheckout(null);
          clearStoredCheckout();
          await loadSeats(null);
        } else {
          await loadSeats(checkout);
        }
      }
    } finally {
      setPaymentLoading(false);
    }
  }

  const currentSeat = checkout
    ? seats.find((seat) => seat.id === checkout.reservation.seatId)
    : null;

  return {
    session,
    sessionLoading,
    seats,
    seatsLoading,
    username,
    password,
    loginLoading,
    logoutLoading,
    selectingSeatId,
    paymentLoading,
    checkout,
    error,
    authenticated,
    hasPendingCheckout,
    canCompletePayment,
    availableCount,
    currentSeat,
    setUsername,
    setPassword,
    handleLogin,
    handleLogout,
    handleSelectSeat,
    handleCompletePayment,
    loadSeats,
  };
}

export type ReservationDeskState = ReturnType<typeof useReservationDesk>;

export const EVENT_EXCHANGE = 'reservation.events';

export const ROUTING_KEYS = {
  reservationHeld: 'seat.reservation.hold_created',
  reservationExpired: 'seat.reservation.expired',
  paymentSucceeded: 'payment.succeeded',
  paymentFailed: 'payment.failed',
  paymentExpired: 'payment.expired',
} as const;

export enum SeatStatus {
  Available = 'available',
  Pending = 'pending',
  Reserved = 'reserved',
}

export enum ReservationStatus {
  PendingPayment = 'pending_payment',
  Reserved = 'reserved',
  Expired = 'expired',
}

export enum PaymentStatus {
  Pending = 'pending',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Expired = 'expired',
}

export interface UserPrincipal {
  id: string;
  username: string;
  tokenVersion: number;
}

export interface SeatView {
  id: string;
  label: string;
  status: SeatStatus;
  available: boolean;
  reservationId?: string;
}

export interface ReservationView {
  id: string;
  seatId: string;
  userId: string;
  status: ReservationStatus;
  paymentId: string;
  createdAt: string;
  expiresAt: string;
  reservedAt?: string;
}

export interface PaymentView {
  id: string;
  reservationId: string;
  userId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface EventEnvelope<TData> {
  id: string;
  type: string;
  version: 1;
  producer: 'seat-service' | 'payment-service' | 'auth-service';
  occurredAt: string;
  traceId?: string;
  data: TData;
}

export interface ReservationHeldEvent {
  reservationId: string;
  paymentId: string;
  seatId: string;
  userId: string;
  amount: number;
  currency: string;
  expiresAt: string;
}

export interface ReservationExpiredEvent {
  reservationId: string;
  paymentId: string;
  seatId: string;
  userId: string;
  reason: 'hold_expired';
}

export interface PaymentOutcomeEvent {
  paymentId: string;
  reservationId: string;
  seatId: string;
  userId: string;
  amount: number;
  currency: string;
  reason?: string;
}

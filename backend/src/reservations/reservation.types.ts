export enum ReservationStatus {
  PendingPayment = 'pending_payment',
  Reserved = 'reserved',
  Expired = 'expired',
}

export interface Reservation {
  id: string;
  seatId: string;
  userId: string;
  status: ReservationStatus;
  paymentId: string;
  createdAt: string;
  expiresAt: string;
  reservedAt?: string;
}

export interface SelectSeatDto {
  seatId?: unknown;
}

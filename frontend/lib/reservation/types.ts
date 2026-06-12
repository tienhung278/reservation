export type SeatStatus = "available" | "pending" | "reserved";

export type Seat = {
  id: string;
  label: string;
  status: SeatStatus;
  available?: boolean;
  reservationId?: string;
};

export type SessionResponse = {
  authenticated?: boolean;
  user?: {
    id?: string;
    username?: string;
    email?: string;
  };
};

export type Reservation = {
  id: string;
  seatId: string;
  userId?: string;
  status: string;
  expiresAt?: string;
  createdAt?: string;
};

export type Payment = {
  id: string;
  status: string;
  userId?: string;
  amount?: number;
  currency?: string;
  expiresAt?: string;
  createdAt?: string;
};

export type Checkout = {
  reservation: Reservation;
  payment: Payment;
};

export enum PaymentStatus {
  Pending = 'pending',
  Succeeded = 'succeeded',
  Expired = 'expired',
}

export interface Payment {
  id: string;
  reservationId: string;
  userId: string;
  status: PaymentStatus;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface CreatePendingPaymentInput {
  reservationId: string;
  userId: string;
  createdAt?: Date;
}

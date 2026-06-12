export enum SeatStatus {
  Available = 'available',
  Pending = 'pending',
  Reserved = 'reserved',
}

export interface SeatView {
  id: string;
  label: string;
  status: SeatStatus;
  available: boolean;
  reservationId?: string;
}

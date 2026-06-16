export class SeatUnavailableError extends Error {
  readonly retryAfterSeconds = 30;

  constructor(message = 'Seat is not available') {
    super(message);
    this.name = 'SeatUnavailableError';
  }
}

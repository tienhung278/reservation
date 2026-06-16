import { InMemoryRateLimiter } from './rate-limit';

describe('InMemoryRateLimiter', () => {
  it('allows requests up to the window limit and returns retry metadata', () => {
    const limiter = new InMemoryRateLimiter(2, 60_000);

    expect(limiter.consume('ip-1', 1000)).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 60,
    });
    expect(limiter.consume('ip-1', 1000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume('ip-1', 1000)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it('resets buckets after the window elapses', () => {
    const limiter = new InMemoryRateLimiter(1, 1000);

    expect(limiter.consume('ip-1', 0).allowed).toBe(true);
    expect(limiter.consume('ip-1', 1).allowed).toBe(false);
    expect(limiter.consume('ip-1', 1001).allowed).toBe(true);
  });
});

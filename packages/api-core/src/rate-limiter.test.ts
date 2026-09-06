import { describe, expect, it } from 'vitest';
import { createMemoryRateLimiter } from './rate-limiter.js';

describe('createMemoryRateLimiter', () => {
  it('allows up to maxAttempts within the window, then denies', async () => {
    const limiter = createMemoryRateLimiter({ windowMs: 60_000, maxAttempts: 3 });
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(true);
    expect((await limiter.consume('k')).allowed).toBe(false);
  });

  it('tracks separate keys independently', async () => {
    const limiter = createMemoryRateLimiter({ windowMs: 60_000, maxAttempts: 1 });
    expect((await limiter.consume('a')).allowed).toBe(true);
    expect((await limiter.consume('b')).allowed).toBe(true);
    expect((await limiter.consume('a')).allowed).toBe(false);
  });

  it('reports remaining attempts decreasing toward zero', async () => {
    const limiter = createMemoryRateLimiter({ windowMs: 60_000, maxAttempts: 2 });
    expect((await limiter.consume('k')).remaining).toBe(1);
    expect((await limiter.consume('k')).remaining).toBe(0);
  });
});

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

  it('forgets a key on reset', async () => {
    const limiter = createMemoryRateLimiter({ windowMs: 60_000, maxAttempts: 1 });
    await limiter.consume('k');
    expect((await limiter.consume('k')).allowed).toBe(false);
    await limiter.reset('k');
    expect((await limiter.consume('k')).allowed).toBe(true);
  });

  it('evicts keys whose attempts have all expired, at most once per window (R5)', async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ windowMs: 1_000, maxAttempts: 5, now: () => now });
    for (let i = 0; i < 100; i += 1) {
      await limiter.consume(`ip-${i}`);
    }
    expect(limiter.size()).toBe(100);

    now = 1_500; // a full window later: every one of those attempts has expired
    await limiter.consume('fresh');
    expect(limiter.size()).toBe(1);
  });

  it('never evicts a key that still has attempts inside the window', async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ windowMs: 1_000, maxAttempts: 2, now: () => now });
    await limiter.consume('old');
    now = 900;
    await limiter.consume('recent');
    now = 1_200; // "old" has expired, "recent" hasn't
    await limiter.consume('recent');
    expect(limiter.size()).toBe(1);
    expect((await limiter.consume('recent')).allowed).toBe(false);
  });
});

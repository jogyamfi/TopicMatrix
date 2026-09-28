import type { RateLimiter } from './deps.js';

export interface MemoryRateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * In-memory RateLimiter (delivery-plan.md P2 task 7) — a real limiter for the Node target,
 * where the process (and this Map) persists across requests. NOT wired into apps/worker: on
 * Workers, in-process state is not reliably shared across isolates/requests (NF-15), so that
 * target keeps `createAllowAllRateLimiter` until a binding-backed implementation lands at P11
 * (Cloudflare's Rate Limiting API). Must be constructed ONCE and reused across requests (a
 * deliberate, intentional singleton — the whole point of a rate limiter is shared state) rather
 * than rebuilt per request like the rest of AppDeps.
 *
 * Keys whose attempts have all expired are swept at most once per window (R5), so the map only
 * ever holds keys active in the last window — without it, every distinct IP or email ever seen
 * would stay in memory for the life of the process.
 */
export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): RateLimiter & { size(): number } {
  const now = options.now ?? Date.now;
  const attemptsByKey = new Map<string, number[]>();
  let lastSweep = now();

  function sweep(current: number): void {
    const windowStart = current - options.windowMs;
    for (const [key, attempts] of attemptsByKey) {
      if (attempts.every((t) => t <= windowStart)) {
        attemptsByKey.delete(key);
      }
    }
    lastSweep = current;
  }

  return {
    async consume(key) {
      const current = now();
      if (current - lastSweep >= options.windowMs) {
        sweep(current);
      }
      const windowStart = current - options.windowMs;
      const recent = (attemptsByKey.get(key) ?? []).filter((t) => t > windowStart);

      if (recent.length >= options.maxAttempts) {
        attemptsByKey.set(key, recent);
        return { allowed: false, remaining: 0 };
      }

      recent.push(current);
      attemptsByKey.set(key, recent);
      return { allowed: true, remaining: options.maxAttempts - recent.length };
    },

    async reset(key) {
      attemptsByKey.delete(key);
    },

    size: () => attemptsByKey.size,
  };
}

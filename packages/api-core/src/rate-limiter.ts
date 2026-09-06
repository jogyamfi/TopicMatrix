import type { RateLimiter } from './deps.js';

export interface MemoryRateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
}

/**
 * In-memory RateLimiter (delivery-plan.md P2 task 7) — a real limiter for the Node target,
 * where the process (and this Map) persists across requests. NOT wired into apps/worker: on
 * Workers, in-process state is not reliably shared across isolates/requests (NF-15), so that
 * target keeps `createAllowAllRateLimiter` until a binding-backed implementation lands at P11
 * (Cloudflare's Rate Limiting API). Must be constructed ONCE and reused across requests (a
 * deliberate, intentional singleton — the whole point of a rate limiter is shared state) rather
 * than rebuilt per request like the rest of AppDeps.
 */
export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): RateLimiter {
  const attemptsByKey = new Map<string, number[]>();

  return {
    async consume(key) {
      const now = Date.now();
      const windowStart = now - options.windowMs;
      const recent = (attemptsByKey.get(key) ?? []).filter((t) => t > windowStart);

      if (recent.length >= options.maxAttempts) {
        attemptsByKey.set(key, recent);
        return { allowed: false, remaining: 0 };
      }

      recent.push(now);
      attemptsByKey.set(key, recent);
      return { allowed: true, remaining: options.maxAttempts - recent.length };
    },
  };
}

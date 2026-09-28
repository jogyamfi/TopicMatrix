import type { Context } from 'hono';
import type { AppConfig, RawEnv } from '@topicmatrix/shared';
import { parseConfig } from '@topicmatrix/shared';
import type { Db, User } from '@topicmatrix/db';
import { createLogger, type Logger } from './logger.js';
import type { PasswordService, PasswordServiceParams } from './auth/password.js';

/** RateLimiter is stateless-by-construction: real implementations differ per runtime (SEC-8). */
export interface RateLimiter {
  consume(key: string): Promise<{ allowed: boolean; remaining: number }>;
  /** Forgets `key`'s attempts (e.g. a successful login clears that email's failures). */
  reset(key: string): Promise<void>;
}

/**
 * Placeholder limiter that always allows. Real limiters (in-memory on Node, a
 * binding/Durable Object on Workers) are implemented at P2 — NF-15 forbids
 * in-process counters on Workers, so this interface exists now so call sites
 * never need to change later.
 */
export function createAllowAllRateLimiter(): RateLimiter {
  return {
    consume: async () => ({ allowed: true, remaining: Number.POSITIVE_INFINITY }),
    reset: async () => {},
  };
}

/**
 * Resolves the trusted client IP for the current request — resolution is fundamentally
 * runtime-specific (raw socket address on Node vs. the `CF-Connecting-IP` header Cloudflare's
 * edge sets and cannot be spoofed via a client-supplied `X-Forwarded-For`), so this is a
 * caller-supplied function rather than something built here, same pattern as `createDb`.
 */
export type ClientIpResolver = (c: Context<AppEnv>) => string;

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  clock: () => Date;
  rateLimiter: RateLimiter;
  db: Db;
  getClientIp: ClientIpResolver;
  passwordService: PasswordService;
}

export type AppVariables = {
  deps: AppDeps;
  requestId: string;
  /** Set by requireAuth once the bearer token has been verified and the user loaded. */
  authUser?: User;
};

export type AppEnv = { Variables: AppVariables };

/**
 * Builds AppDeps from a raw env-like record. Called fresh per request by both entrypoints
 * (from `process.env` on Node, from the Workers `env` binding argument) so nothing here is a
 * module-level singleton (NF-15).
 *
 * `createDb` is a caller-supplied factory rather than something this module constructs itself:
 * this file is shared by both entrypoints, and Prisma's regular sqlite/postgresql client needs
 * Node built-ins just to load — importing it here (even just to re-export) drags that into
 * apps/worker's bundle and breaks under `workerd`. `apps/api` passes a process-scoped cache
 * (`createProcessDbCache` from `@topicmatrix/db/node`) so every request shares ONE connection
 * pool — `createDb` is called per request, so it must not open a new pool each time;
 * `apps/worker` passes `createDb` (from the main `@topicmatrix/db` barrel, d1-only for now — see
 * packages/db/src/db.ts).
 *
 * `rateLimiter` is optional and defaults to allow-all: it's the one exception to "rebuilt fresh
 * per request" — a rate limiter needs state that persists ACROSS requests to mean anything, so
 * callers that want real limiting construct one instance once (e.g. at Node module scope in
 * apps/api) and pass the SAME instance into every `buildDeps` call.
 *
 * `createPasswordService` is likewise caller-supplied: hash-wasm (the chosen Argon2id
 * implementation, ADR-002) only works where dynamic WebAssembly compilation is allowed, which
 * Cloudflare Workers disallows ("Wasm code generation disallowed by embedder", proven by
 * apps/worker/src/argon2-bench.cf.test.ts). `apps/api` passes the real hash-wasm-backed
 * factory; `apps/worker` passes `createUnavailablePasswordService` until a Workers-compatible
 * implementation is wired at P11.
 */
export interface BuildDepsOptions {
  createDb: (config: AppConfig) => Db;
  getClientIp: ClientIpResolver;
  createPasswordService: (params: PasswordServiceParams) => PasswordService;
  rateLimiter?: RateLimiter;
}

export function buildDeps(env: RawEnv, opts: BuildDepsOptions): AppDeps {
  const config = parseConfig(env);
  return {
    config,
    logger: createLogger(config.logLevel),
    clock: () => new Date(),
    rateLimiter: opts.rateLimiter ?? createAllowAllRateLimiter(),
    db: opts.createDb(config),
    getClientIp: opts.getClientIp,
    passwordService: opts.createPasswordService({
      memoryKib: config.argon2MemoryKib,
      iterations: config.argon2Iterations,
    }),
  };
}

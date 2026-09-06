import type { AppConfig, RawEnv } from '@topicmatrix/shared';
import { parseConfig } from '@topicmatrix/shared';
import type { Db } from '@topicmatrix/db';
import { createLogger, type Logger } from './logger.js';

/** RateLimiter is stateless-by-construction: real implementations differ per runtime (SEC-8). */
export interface RateLimiter {
  consume(key: string): Promise<{ allowed: boolean; remaining: number }>;
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
  };
}

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  clock: () => Date;
  rateLimiter: RateLimiter;
  db: Db;
}

export type AppVariables = {
  deps: AppDeps;
  requestId: string;
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
 * apps/worker's bundle and breaks under `workerd`. `apps/api` passes `createNodeDb` (from
 * `@topicmatrix/db/node`); `apps/worker` passes `createDb` (from the main `@topicmatrix/db`
 * barrel, d1-only for now — see packages/db/src/db.ts).
 */
export function buildDeps(env: RawEnv, createDb: (config: AppConfig) => Db): AppDeps {
  const config = parseConfig(env);
  return {
    config,
    logger: createLogger(config.logLevel),
    clock: () => new Date(),
    rateLimiter: createAllowAllRateLimiter(),
    db: createDb(config),
  };
}

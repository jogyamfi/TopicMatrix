import type { AppConfig } from '@topicmatrix/shared';
import { PrismaClient as SqlitePrismaClient } from '../generated/sqlite/index.js';
import { PrismaClient as PostgresPrismaClient } from '../generated/postgres/index.js';
import type { PrismaClient } from './types.js';

/**
 * Builds the Prisma client for `sqlite`/`postgresql`. Constructed fresh per call, and each client
 * owns a connection pool — long-lived callers (the Node API) must reuse one per process via
 * `createProcessDbCache` (node.ts) rather than calling this per request.
 *
 * D1 is NOT handled here: it needs a live Workers `D1Database` binding (not a `DATABASE_URL`),
 * which only exists inside a `workerd` request. Wiring it into `apps/worker`'s per-request deps
 * is a P11 task (delivery-plan.md P11 task 3) — see `createDb` in db.ts for how the `d1` provider
 * is handled in the meantime (a `Db` whose methods throw a clear, documented error) so `/healthz`
 * and `/readyz` keep working under `wrangler dev` before that wiring exists.
 */
export function createPrismaClient(config: AppConfig): PrismaClient {
  switch (config.databaseProvider) {
    case 'postgresql':
      return new PostgresPrismaClient({
        datasourceUrl: requireDatabaseUrl(config),
      }) as unknown as PrismaClient;
    case 'sqlite':
      // Prisma's SQLite connector enables `PRAGMA foreign_keys` by default — verified empirically
      // while implementing this (NF-8) — so no extra per-connection setup is needed here.
      return new SqlitePrismaClient({
        datasourceUrl: requireDatabaseUrl(config),
      }) as unknown as PrismaClient;
    case 'd1':
      throw new Error(
        "createPrismaClient does not support 'd1' — construct via createD1PrismaClient with a " +
          'live D1 binding instead (P11). See db.ts createDb for the provider dispatch.',
      );
  }
}

// parseConfig (packages/shared) already fails closed if DATABASE_URL is missing for sqlite/
// postgresql — this only narrows the type, it can't fire in practice.
function requireDatabaseUrl(config: AppConfig): string {
  if (!config.databaseUrl) {
    throw new Error(`DATABASE_URL is required for ${config.databaseProvider}`);
  }
  return config.databaseUrl;
}

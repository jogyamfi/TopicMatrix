// Node-only: constructs a `Db` backed by real sqlite/postgresql Prisma clients. Import this
// ONLY from apps/api or Node-context test code — NEVER from packages/api-core or anything
// reachable from apps/worker's module graph. Prisma's regular (non-driver-adapter) generated
// client needs Node built-ins just to load (see db.ts's `createDb` doc comment for how this was
// discovered): importing it anywhere reachable from the Worker breaks `wrangler`/esbuild
// bundling even if the code path is never executed at runtime.
import type { AppConfig } from '@topicmatrix/shared';
import { createPrismaClient } from './client.js';
import { createSqlUnitOfWork } from './unit-of-work.js';
import { buildRepositories, type Db } from './db.js';

export function createNodeDb(config: AppConfig): Db {
  if (config.databaseProvider === 'd1') {
    throw new Error(
      "createNodeDb does not support 'd1' — use createDb from the main '@topicmatrix/db' barrel " +
        'instead (see db.ts).',
    );
  }

  const client = createPrismaClient(config);
  return {
    provider: config.databaseProvider,
    ...buildRepositories(client),
    unitOfWork: createSqlUnitOfWork(client),
    disconnect: () => client.$disconnect(),
  };
}

export interface ProcessDbCache {
  /** Drop-in for `createNodeDb` as a `buildDeps` `createDb` option — same config, same `Db`. */
  getDb(config: AppConfig): Db;
  disconnectAll(): Promise<void>;
}

/**
 * A Prisma client owns a connection pool, so the Node entrypoint must build ONE per process and
 * reuse it — calling `createNodeDb` per request (as `buildDeps` does with whatever `createDb` it
 * is given) opens a fresh pool on every request and never closes it, exhausting PostgreSQL's
 * connections. Like the rate limiter, the pool is process-scoped infrastructure: the deliberate
 * exception to NF-15's "rebuilt per request", which only ever applied to request-derived state.
 * Keyed by provider + URL so a (theoretical) config change still gets a matching client.
 */
export function createProcessDbCache(): ProcessDbCache {
  const dbsByKey = new Map<string, Db>();
  return {
    getDb(config) {
      const key = `${config.databaseProvider}\u0000${config.databaseUrl ?? ''}`;
      let db = dbsByKey.get(key);
      if (!db) {
        db = createNodeDb(config);
        dbsByKey.set(key, db);
      }
      return db;
    },
    async disconnectAll() {
      const dbs = [...dbsByKey.values()];
      dbsByKey.clear();
      await Promise.all(dbs.map((db) => db.disconnect()));
    },
  };
}

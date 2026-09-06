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

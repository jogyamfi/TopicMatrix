// The ONLY place Node built-ins are allowed to be imported (NF-13) — enforced by ESLint.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { createApp, buildDeps, createMemoryRateLimiter, createPasswordService } from '@topicmatrix/api-core';
import { createProcessDbCache } from '@topicmatrix/db/node';
import { getNodeClientIp } from './client-ip.js';

// npm workspace scripts run with cwd set to apps/api, not the repo root, so the default
// cwd-relative dotenv lookup would miss the root .env — resolve it explicitly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

// The deliberate exceptions to "rebuilt per request" (NF-15) — process-scoped infrastructure
// whose whole point is to persist across requests:
// - the rate limiter's counters (FR-1.10: 10 attempts / 15 min per IP and per email);
// - the database connection pool — a Prisma client per request would open a new pool every
//   time and never close it (see createProcessDbCache).
const loginRateLimiter = createMemoryRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });
const dbCache = createProcessDbCache();

function buildRequestDeps() {
  return buildDeps(process.env, {
    createDb: (config) => dbCache.getDb(config),
    getClientIp: getNodeClientIp,
    rateLimiter: loginRateLimiter,
    createPasswordService,
  });
}

// process.env is read fresh inside the factory on every request (NF-15); this one-off call
// is only to learn the port/logger to start listening, not a cached deps singleton.
const startupDeps = buildRequestDeps();
const app = createApp(buildRequestDeps);

const server = serve({ fetch: app.fetch, port: startupDeps.config.port }, (info) => {
  startupDeps.logger.info('server_started', {
    port: info.port,
    provider: startupDeps.config.databaseProvider,
  });
});

function shutdown(signal: string): void {
  startupDeps.logger.info('server_stopping', { signal });
  server.close(() => {
    void dbCache.disconnectAll().finally(() => process.exit(0));
  });
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

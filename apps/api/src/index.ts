// The ONLY place Node built-ins are allowed to be imported (NF-13) — enforced by ESLint.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { createApp, buildDeps, createMemoryRateLimiter, createPasswordService } from '@topicmatrix/api-core';
import { createNodeDb } from '@topicmatrix/db/node';
import { getNodeClientIp } from './client-ip.js';

// npm workspace scripts run with cwd set to apps/api, not the repo root, so the default
// cwd-relative dotenv lookup would miss the root .env — resolve it explicitly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

// The one deliberate exception to "rebuilt per request" (NF-15): a rate limiter's counters must
// persist ACROSS requests to do anything, so this single instance is constructed once and
// passed into every buildDeps call below (FR-1.10: 10 attempts / 15 min per IP and per email).
const loginRateLimiter = createMemoryRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 10 });

function buildRequestDeps() {
  return buildDeps(process.env, {
    createDb: createNodeDb,
    getClientIp: getNodeClientIp,
    rateLimiter: loginRateLimiter,
    createPasswordService,
  });
}

// process.env is read fresh inside the factory on every request (NF-15); this one-off call
// is only to learn the port/logger to start listening, not a cached deps singleton.
const startupDeps = buildRequestDeps();
const app = createApp(buildRequestDeps);

serve({ fetch: app.fetch, port: startupDeps.config.port }, (info) => {
  startupDeps.logger.info('server_started', {
    port: info.port,
    provider: startupDeps.config.databaseProvider,
  });
});


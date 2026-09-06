// The ONLY place Node built-ins are allowed to be imported (NF-13) — enforced by ESLint.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { createApp, buildDeps } from '@topicmatrix/api-core';

// npm workspace scripts run with cwd set to apps/api, not the repo root, so the default
// cwd-relative dotenv lookup would miss the root .env — resolve it explicitly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

// process.env is read fresh inside the factory on every request (NF-15); this one-off call
// is only to learn the port/logger to start listening, not a cached deps singleton.
const startupDeps = buildDeps(process.env);
const app = createApp(() => buildDeps(process.env));

serve({ fetch: app.fetch, port: startupDeps.config.port }, (info) => {
  startupDeps.logger.info('server_started', {
    port: info.port,
    provider: startupDeps.config.databaseProvider,
  });
});

// Node-only dev/CI test tooling (exempt from NF-13, same rationale as packages/db/test/*).
// Provisions its own real, migrated temp SQLite database rather than importing
// packages/db/test/setup.ts across the package boundary — Vite/vitest's module resolution
// couldn't reliably load a `.js`-specifier relative import reaching outside this package's
// directory tree in practice, and keeping each package's test infra self-contained avoids that
// entirely.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import type { AppConfig } from '@topicmatrix/shared';
import { createNodeDb } from '@topicmatrix/db/node';
import { createFixtures, type Db, type Fixtures } from '@topicmatrix/db';
import { createApp } from '../src/index.js';
import { createLogger } from '../src/logger.js';
import { createMemoryRateLimiter } from '../src/rate-limiter.js';
import { createPasswordService } from '../src/auth/password.js';
import type { AppDeps, AppEnv } from '../src/deps.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ApiTestContext {
  app: Hono<AppEnv>;
  db: Db;
  fixtures: Fixtures;
  teardown: () => Promise<void>;
}

export interface SetupApiTestOptions {
  rateLimiterMaxAttempts?: number;
  rateLimiterWindowMs?: number;
  clientIp?: string;
  configOverrides?: Partial<AppConfig>;
  /** Replaces `deps.clock` (default: real time), for tests that need to move time forward. */
  clock?: () => Date;
}

function testConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    databaseProvider: 'sqlite',
    databaseUrl: undefined,
    nodeEnv: 'test',
    port: 3000,
    corsOrigins: [],
    jwtSecret: 'a'.repeat(32),
    argon2MemoryKib: 19456,
    argon2Iterations: 2,
    logLevel: 'error',
    trustProxyHops: 0,
    defaultTimezone: 'Europe/London',
    ...overrides,
  };
}

/** Same approach as packages/db/test/setup.ts — a fresh temp SQLite file, migrated for real. */
export async function setupApiTest(options: SetupApiTestOptions = {}): Promise<ApiTestContext> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'topicmatrix-api-core-test-'));
  const databaseUrl = `file:${path.join(tmpDir, 'test.db').split(path.sep).join('/')}`;
  execSync('npx prisma migrate deploy --schema=prisma/sqlite/schema.prisma', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  const config = testConfig({ databaseUrl, ...(options.configOverrides ?? {}) });
  const db = createNodeDb(config);
  const clientIp = options.clientIp ?? '127.0.0.1';

  const deps: AppDeps = {
    config,
    logger: createLogger('error'),
    clock: options.clock ?? (() => new Date()),
    rateLimiter: createMemoryRateLimiter({
      windowMs: options.rateLimiterWindowMs ?? 15 * 60 * 1000,
      maxAttempts: options.rateLimiterMaxAttempts ?? 10,
    }),
    db,
    getClientIp: () => clientIp,
    passwordService: createPasswordService({
      memoryKib: config.argon2MemoryKib,
      iterations: config.argon2Iterations,
    }),
  };

  return {
    app: createApp(() => deps),
    db,
    fixtures: createFixtures(db),
    teardown: async () => {
      await db.disconnect();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}


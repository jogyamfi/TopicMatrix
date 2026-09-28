// Node-only dev/CI test tooling (exempt from NF-13, same rationale as packages/db/test/*).
// Provisions its own real, migrated scratch database (SQLite, or PostgreSQL when
// DATABASE_PROVIDER=postgresql) rather than importing
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
    cookieSecure: true,
    ...overrides,
  };
}

interface ScratchDatabase {
  provider: 'sqlite' | 'postgresql';
  databaseUrl: string;
  destroy: () => void;
}

/**
 * A fresh, fully migrated database for one test context. SQLite (the default): a temp file.
 * PostgreSQL (`DATABASE_PROVIDER=postgresql`, R5): a uniquely named schema in the server at
 * DATABASE_URL (default: docker-compose.dev.yml's), dropped afterwards — as isolated as the
 * SQLite files, so the whole route suite can run against real PostgreSQL too.
 */
function createScratchDatabase(): ScratchDatabase {
  if (process.env.DATABASE_PROVIDER === 'postgresql') {
    const serverUrl =
      process.env.DATABASE_URL ?? 'postgresql://topicmatrix:topicmatrix@localhost:5432/topicmatrix';
    const schema = `api_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const databaseUrl = `${serverUrl}${serverUrl.includes('?') ? '&' : '?'}schema=${schema}`;
    execSync('npx prisma migrate deploy --schema=prisma/postgres/schema.prisma', {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    return {
      provider: 'postgresql',
      databaseUrl,
      destroy: () =>
        execSync(`npx prisma db execute --url "${serverUrl}" --stdin`, {
          cwd: repoRoot,
          input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`,
          stdio: ['pipe', 'ignore', 'inherit'],
        }),
    };
  }

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'topicmatrix-api-core-test-'));
  const databaseUrl = `file:${path.join(tmpDir, 'test.db').split(path.sep).join('/')}`;
  execSync('npx prisma migrate deploy --schema=prisma/sqlite/schema.prisma', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  return { provider: 'sqlite', databaseUrl, destroy: () => rmSync(tmpDir, { recursive: true, force: true }) };
}

export async function setupApiTest(options: SetupApiTestOptions = {}): Promise<ApiTestContext> {
  const scratch = createScratchDatabase();
  const config = testConfig({
    databaseProvider: scratch.provider,
    databaseUrl: scratch.databaseUrl,
    ...(options.configOverrides ?? {}),
  });
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
      scratch.destroy();
    },
  };
}


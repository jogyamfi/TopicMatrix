// Node-only dev/CI tooling (exempt from NF-13 — see eslint.config.js). Never imported by
// application code; only by packages/db/test/*.integration.test.ts.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '@topicmatrix/shared';
import type { Db } from '../src/db.js';
import { createNodeDb } from '../src/node.js';
import { createFixtures, type Fixtures } from '../src/fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface IntegrationTestContext {
  db: Db;
  fixtures: Fixtures;
  provider: 'sqlite' | 'postgresql';
  teardown: () => Promise<void>;
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
    ...overrides,
  };
}

function runMigrateDeploy(schemaDir: 'sqlite' | 'postgres', databaseUrl: string): void {
  execSync(`npx prisma migrate deploy --schema=prisma/${schemaDir}/schema.prisma`, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

/**
 * Provisions a real, migrated database for the configured provider (`DATABASE_PROVIDER` env var,
 * default sqlite) and returns a real `Db` + `Fixtures` to test against. Requires
 * `npm run db:generate-schemas` to have already produced `prisma/<provider>/schema.prisma` — the
 * `test:integration*` npm scripts do this before invoking vitest.
 */
export async function setupIntegrationTest(): Promise<IntegrationTestContext> {
  if (process.env.DATABASE_PROVIDER === 'postgresql') {
    const databaseUrl =
      process.env.DATABASE_URL ?? 'postgresql://topicmatrix:topicmatrix@localhost:5432/topicmatrix';
    runMigrateDeploy('postgres', databaseUrl);
    const db = createNodeDb(testConfig({ databaseProvider: 'postgresql', databaseUrl }));
    return { db, fixtures: createFixtures(db), provider: 'postgresql', teardown: () => db.disconnect() };
  }

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'topicmatrix-test-'));
  const databaseUrl = `file:${path.join(tmpDir, 'test.db').split(path.sep).join('/')}`;
  runMigrateDeploy('sqlite', databaseUrl);
  const db = createNodeDb(testConfig({ databaseProvider: 'sqlite', databaseUrl }));
  return {
    db,
    fixtures: createFixtures(db),
    provider: 'sqlite',
    teardown: async () => {
      await db.disconnect();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

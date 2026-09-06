// Applies the D1 migrations (read by vitest.workers.config.ts) to the isolated per-test-run
// D1 instance before any *.cf.test.ts runs, so spike tests see real tables (P0 task 8).
import { applyD1Migrations, env } from 'cloudflare:test';

interface MigrationEnv {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
}

const { DB, TEST_MIGRATIONS } = env as unknown as MigrationEnv;

await applyD1Migrations(DB, TEST_MIGRATIONS);

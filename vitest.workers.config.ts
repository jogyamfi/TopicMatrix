import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

// Runs *.cf.test.ts inside real workerd via miniflare (P0 D1 spike, task 8/12). Requires
// Cloudflare tooling (wrangler, workerd) to be installed — `npm run test:cf` is a separate
// script from the default `npm test` precisely so its absence never blocks T1 (NF-11a).
export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, 'apps/worker/migrations');
  const migrations = await readD1Migrations(migrationsPath);
  return {
    test: {
      include: ['apps/worker/**/*.cf.test.ts'],
      setupFiles: ['./apps/worker/test/apply-d1-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './apps/worker/wrangler.toml' },
          miniflare: {
            d1Databases: ['DB'],
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});

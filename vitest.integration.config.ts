import { defineConfig } from 'vitest/config';

// Real-database integration tests (delivery-plan.md P1 task 11): `npm run test:integration`
// (SQLite, no external service — the default `test:integration` provider) and
// `npm run test:integration:pg` (against docker-compose.dev.yml's PostgreSQL) both use this
// config, selecting the provider via DATABASE_PROVIDER (see packages/db/test/setup.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Provisioning a scratch database (running migrations) can be slower than pure unit tests.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

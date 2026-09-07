import { defineConfig } from 'vitest/config';

// Coverage gate (NF-6, delivery-plan.md P10 task 7): runs BOTH the fast unit suite and the
// real-database integration suite in one process so a single coverage report covers everything
// that isn't Workers-only (`*.cf.test.ts`, still separately gated by `npm run test:cf`) —
// most of `packages/db` and `packages/api-core/src/routes` is only exercised by the integration
// suite (real repositories/routes against a migrated SQLite database), not the pure-logic unit
// suite, so measuring coverage from the unit suite alone would under-report real coverage.
// `npm run test:coverage` requires `npm run db:generate-schemas` to have been run first (same
// prerequisite as `npm run test:integration`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**', '**/*.cf.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.integration.test.ts', '**/*.cf.test.ts', '**/generated/**', '**/*.d.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
        'packages/core/src/**': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // *.cf.test.ts files require workerd (via @cloudflare/vitest-pool-workers, NF-11a) and
    // only run under `npm run test:cf` — see vitest.workers.config.ts. *.integration.test.ts
    // files need a real (migrated) database and only run under `npm run test:integration[:pg]`
    // — see vitest.integration.config.ts.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.wrangler/**',
      '**/*.cf.test.ts',
      '**/*.integration.test.ts',
    ],
  },
});

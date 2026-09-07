import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

// End-to-end suite (delivery-plan.md P10 task 6). Runs against the real T1 local loop (Vite +
// Node API, SQLite) via `scripts/e2e-server.mjs`'s dedicated scratch database — never the
// developer's own dev.db. `workers: 1`/`fullyParallel: false` because the suite is written as
// one long, stateful walkthrough (first-run admin seed through export), not independent specs.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `${BASE_URL}/api/healthz`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});

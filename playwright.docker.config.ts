import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

// The same E2E suite, unmodified, against the self-hosted Docker stack (R5; the P11 plan asks the
// same of the Workers target). Bring up a FRESH stack first — the suite starts from the first-run
// admin seed:
//
//   JWT_SECRET=<32+ chars> docker compose -p topicmatrix-e2e up --build -d --wait
//   docker compose -p topicmatrix-e2e exec -e SEED_ADMIN_PASSWORD='E2eAdminPass123!' api npm run seed:admin -w apps/api
//   npm run test:e2e:docker
//   docker compose -p topicmatrix-e2e down -v
//
// localhost is exempt from the Secure-cookie rule, so plain http://localhost:8080 works here.
export default defineConfig({
  ...baseConfig,
  use: { ...baseConfig.use, baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080' },
  webServer: undefined,
});

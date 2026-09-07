// Playwright's `webServer` for the E2E suite (P10 task 6): resets a scratch SQLite database,
// seeds the first admin with a KNOWN password (only this script sets SEED_ADMIN_PASSWORD — the
// real seed:admin CLI still generates a random one-time password for every other caller), then
// starts the normal `npm run dev` T1 loop against it. A plain shell `&&` chain isn't used here
// because `cross-env VAR=x command` only scopes VAR to that one command, not to everything after
// a `&&` in the same string — explicit `execSync`/`spawn` env objects avoid that footgun.
import { execSync, spawn } from 'node:child_process';

const env = {
  ...process.env,
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: 'file:./e2e-test.db',
  JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-test-only-secret-at-least-32-characters',
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'E2eAdminPass123!',
};

console.log('[e2e] Resetting the e2e scratch database...');
execSync('npx tsx scripts/generate-schemas.ts', { stdio: 'inherit', env });
execSync('npx prisma migrate reset --force --schema=prisma/sqlite/schema.prisma', {
  stdio: 'inherit',
  env,
});

console.log('[e2e] Seeding the first admin user...');
execSync('npm run seed:admin -w apps/api', { stdio: 'inherit', env });

console.log('[e2e] Starting the dev servers...');
const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 0));

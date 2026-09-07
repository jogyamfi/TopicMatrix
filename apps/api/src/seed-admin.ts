// One-time seed CLI (FR-1.9): creates the first ADMIN user. Node-only (apps/api is the only
// place Node built-ins are allowed, NF-13). Refuses to run if any user already exists, so it
// can never be used to create a second admin or reset an existing deployment by accident.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseConfig } from '@topicmatrix/shared';
import { createNodeDb } from '@topicmatrix/db/node';
import { createPasswordService, randomOpaqueToken } from '@topicmatrix/api-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_DISPLAY_NAME = process.env.SEED_ADMIN_DISPLAY_NAME ?? 'Administrator';

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const db = createNodeDb(config);

  try {
    const existingCount = await db.users.count();
    if (existingCount > 0) {
      console.log(
        JSON.stringify({
          level: 'error',
          message: 'seed:admin refused: at least one user already exists (FR-1.9)',
        }),
      );
      process.exitCode = 1;
      return;
    }

    const passwordService = createPasswordService({
      memoryKib: config.argon2MemoryKib,
      iterations: config.argon2Iterations,
    });
    // Override for the Playwright E2E suite only (P10) — it needs a KNOWN password to log in
    // with; every other caller gets the usual random one-time value.
    const temporaryPassword = process.env.SEED_ADMIN_PASSWORD ?? randomOpaqueToken(9);
    const passwordHash = await passwordService.hash(temporaryPassword);

    const admin = await db.users.create({
      email: ADMIN_EMAIL,
      emailNormalised: ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      displayName: ADMIN_DISPLAY_NAME,
      role: 'ADMIN',
      mustChangePassword: true,
    });
    await db.userSettings.createDefault(admin.id);

    console.log(
      JSON.stringify({
        level: 'info',
        message: 'seed:admin complete — record this password now, it is never shown again',
        email: admin.email,
        temporaryPassword,
      }),
    );
  } finally {
    await db.disconnect();
  }
}

main().catch((err: unknown) => {
  console.log(
    JSON.stringify({
      level: 'error',
      message: 'seed:admin failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exitCode = 1;
});

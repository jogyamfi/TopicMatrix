// Regenerates the per-provider Prisma schemas and all three generated clients
// (packages/db/generated/{sqlite,postgres,d1}). None of this needs a database connection.
//
// `--if-missing` skips the work when every client already exists — used by `pretest` so that a
// fresh clone's `npm test` works without making every test run pay for a full regeneration.
// After editing prisma/model.prisma, run `npm run db:generate` (or `npm run db:migrate`, which
// regenerates as part of `prisma migrate dev`).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const providers = ['sqlite', 'postgres', 'd1'];

const ifMissing = process.argv.includes('--if-missing');
const allPresent = providers.every((p) =>
  existsSync(path.join(repoRoot, 'packages', 'db', 'generated', p, 'index.js')),
);
if (ifMissing && allPresent) {
  process.exit(0);
}

execSync('npx tsx scripts/generate-schemas.ts', { cwd: repoRoot, stdio: 'inherit' });
for (const provider of providers) {
  execSync(`npx prisma generate --schema=prisma/${provider}/schema.prisma`, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

// Regenerates the provider schemas, then runs `prisma migrate dev` against the schema
// matching DATABASE_PROVIDER (defaults to sqlite — the T1 baseline, FR-D.7).
import 'dotenv/config';
import { execSync } from 'node:child_process';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';

execSync('npx tsx scripts/generate-schemas.ts', { stdio: 'inherit' });

if (provider === 'd1') {
  console.log(
    'D1 has no `prisma migrate dev`. Migrations are generated with `prisma migrate diff` and ' +
      'applied with `wrangler d1 migrations apply` (see P1/P11).',
  );
  process.exit(0);
}

const schemaFile = provider === 'postgresql' ? 'schema.postgres.prisma' : 'schema.sqlite.prisma';
execSync(`npx prisma migrate dev --schema=prisma/${schemaFile}`, { stdio: 'inherit' });

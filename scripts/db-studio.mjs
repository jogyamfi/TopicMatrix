import 'dotenv/config';
import { execSync } from 'node:child_process';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';

if (provider === 'd1') {
  console.log('Use `wrangler d1 execute --local` or the D1 dashboard to inspect a D1 database.');
  process.exit(0);
}

const schemaFile = provider === 'postgresql' ? 'schema.postgres.prisma' : 'schema.sqlite.prisma';
execSync('npx tsx scripts/generate-schemas.ts', { stdio: 'inherit' });
execSync(`npx prisma studio --schema=prisma/${schemaFile}`, { stdio: 'inherit' });

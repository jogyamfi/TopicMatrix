import 'dotenv/config';
import { execSync } from 'node:child_process';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';

if (provider === 'd1') {
  console.log('Use `wrangler d1 execute --local --command "..."` to reset a local D1 database.');
  process.exit(0);
}

execSync('npx tsx scripts/generate-schemas.ts', { stdio: 'inherit' });
const schemaFile = provider === 'postgresql' ? 'schema.postgres.prisma' : 'schema.sqlite.prisma';
execSync(`npx prisma migrate reset --force --schema=prisma/${schemaFile}`, { stdio: 'inherit' });

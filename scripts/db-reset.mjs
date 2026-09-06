import 'dotenv/config';
import { execSync } from 'node:child_process';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';

if (provider === 'd1') {
  console.log('Use `wrangler d1 execute --local --command "..."` to reset a local D1 database.');
  process.exit(0);
}

execSync('npx tsx scripts/generate-schemas.ts', { stdio: 'inherit' });
const schemaDir = provider === 'postgresql' ? 'postgres' : 'sqlite';
execSync(`npx prisma migrate reset --force --schema=prisma/${schemaDir}/schema.prisma`, {
  stdio: 'inherit',
});

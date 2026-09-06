import 'dotenv/config';
import { execSync } from 'node:child_process';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';

if (provider === 'd1') {
  console.log('Use `wrangler d1 execute --local` or the D1 dashboard to inspect a D1 database.');
  process.exit(0);
}

const schemaDir = provider === 'postgresql' ? 'postgres' : 'sqlite';
execSync('npx tsx scripts/generate-schemas.ts', { stdio: 'inherit' });
execSync(`npx prisma studio --schema=prisma/${schemaDir}/schema.prisma`, { stdio: 'inherit' });

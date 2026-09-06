// One-time seed CLI (FR-1.9): refuses to run if any user exists. Real implementation
// arrives at P2 once the User model and repository layer exist (P1). This placeholder
// exists so `npm run seed:admin` is a wired, discoverable command from P0 onward.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

console.log(
  JSON.stringify({
    level: 'info',
    message: 'seed:admin is not implemented yet — the User model lands at P1, the seed logic at P2.',
  }),
);
process.exitCode = 1;

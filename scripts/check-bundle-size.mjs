// Enforces the 3 MB compressed Worker bundle-size gate (NF-14) in CI.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const [, , dirArg, limitArg] = process.argv;
const dir = dirArg ?? 'apps/worker/dist';
const limitBytes = Number(limitArg ?? 3 * 1024 * 1024);

function walk(current) {
  const entries = readdirSync(current, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(current, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

let totalCompressed = 0;
const files = walk(dir).filter((f) => f.endsWith('.js'));

if (files.length === 0) {
  console.error(`No .js output found under ${dir} — did the worker build run?`);
  process.exit(1);
}

for (const file of files) {
  const raw = readFileSync(file);
  const compressed = gzipSync(raw).length;
  totalCompressed += compressed;
  console.log(`${path.relative(dir, file)}: ${statSync(file).size} bytes raw, ${compressed} bytes gzip`);
}

console.log(`Total compressed: ${totalCompressed} bytes (limit ${limitBytes} bytes)`);

if (totalCompressed > limitBytes) {
  console.error(`Bundle-size gate failed: ${totalCompressed} > ${limitBytes} (NF-14).`);
  process.exit(1);
}

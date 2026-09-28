// Node-only test tooling (exempt from NF-13 — see eslint.config.js), run by the fast unit suite.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function sqlFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sqlFilesUnder(full);
    return name.endsWith('.sql') ? [full] : [];
  });
}

const migrationFiles = [
  ...sqlFilesUnder(path.join(repoRoot, 'prisma', 'sqlite', 'migrations')),
  ...sqlFilesUnder(path.join(repoRoot, 'prisma', 'postgres', 'migrations')),
  ...sqlFilesUnder(path.join(repoRoot, 'apps', 'worker', 'migrations')),
];

describe('migration files', () => {
  it('finds the migrations for every provider', () => {
    expect(migrationFiles.length).toBeGreaterThan(5);
  });

  // PostgreSQL rejects a UTF-8 byte-order mark at the start of a script ("syntax error at or near
  // U+FEFF") — the P1 postgres init migration had one, so `prisma migrate deploy` (and therefore
  // the Docker stack) could never start on a fresh database. SQLite/D1 tolerate it, which is how
  // it went unnoticed. Found in R5 when the migrations were first run against real PostgreSQL.
  it.each(migrationFiles.map((f) => [path.relative(repoRoot, f), f]))('%s has no byte-order mark', (_name, file) => {
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});

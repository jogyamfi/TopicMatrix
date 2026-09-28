import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@topicmatrix/shared';
import { createProcessDbCache } from './node.js';

function config(databaseUrl: string): AppConfig {
  return {
    databaseProvider: 'sqlite',
    databaseUrl,
    nodeEnv: 'test',
    port: 3000,
    corsOrigins: [],
    jwtSecret: 'a'.repeat(32),
    argon2MemoryKib: 19456,
    argon2Iterations: 2,
    logLevel: 'error',
    trustProxyHops: 0,
    defaultTimezone: 'Europe/London',
    cookieSecure: true,
  };
}

// Constructing a Prisma client doesn't connect, so no database is needed here.
describe('createProcessDbCache', () => {
  const cache = createProcessDbCache();
  afterEach(() => cache.disconnectAll());

  it('returns the same Db for every call with the same config (one pool per process)', () => {
    const first = cache.getDb(config('file:./a.db'));
    for (let i = 0; i < 50; i += 1) {
      expect(cache.getDb(config('file:./a.db'))).toBe(first);
    }
  });

  it('builds a separate Db for a different database URL', () => {
    expect(cache.getDb(config('file:./a.db'))).not.toBe(cache.getDb(config('file:./b.db')));
  });

  it('builds a fresh Db after disconnectAll', async () => {
    const before = cache.getDb(config('file:./a.db'));
    await cache.disconnectAll();
    expect(cache.getDb(config('file:./a.db'))).not.toBe(before);
  });
});

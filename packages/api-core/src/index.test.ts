import { describe, expect, it } from 'vitest';
import { createNodeDb } from '@topicmatrix/db/node';
import { createApp } from './index.js';
import { buildDeps } from './deps.js';

function testDeps() {
  return buildDeps(
    {
      DATABASE_PROVIDER: 'sqlite',
      DATABASE_URL: 'file:./dev.db',
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
    },
    createNodeDb,
  );
}

describe('createApp health routes', () => {
  it('GET /healthz returns ok', async () => {
    const app = createApp(testDeps);
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns ok and the configured database provider', async () => {
    const app = createApp(testDeps);
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', databaseProvider: 'sqlite' });
  });

  it('attaches an x-request-id header, propagating an incoming one', async () => {
    const app = createApp(testDeps);
    const res = await app.request('/healthz', { headers: { 'x-request-id': 'test-id-123' } });
    expect(res.headers.get('x-request-id')).toBe('test-id-123');
  });

  it('generates an x-request-id header when none is supplied', async () => {
    const app = createApp(testDeps);
    const res = await app.request('/healthz');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});

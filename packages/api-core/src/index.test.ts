import { describe, expect, it } from 'vitest';
import { createNodeDb } from '@topicmatrix/db/node';
import { createApp } from './index.js';
import { buildDeps } from './deps.js';
import { createPasswordService } from './auth/password.js';

function testDeps() {
  return buildDeps(
    {
      DATABASE_PROVIDER: 'sqlite',
      DATABASE_URL: 'file:./dev.db',
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
    },
    { createDb: createNodeDb, getClientIp: () => '127.0.0.1', createPasswordService },
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

  it('applies security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy) — SEC-6', async () => {
    const app = createApp(testDeps);
    const res = await app.request('/healthz');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('reflects an allow-listed CORS origin but not an unlisted one — SEC-7', async () => {
    const app = createApp(() =>
      buildDeps(
        {
          DATABASE_PROVIDER: 'sqlite',
          DATABASE_URL: 'file:./dev.db',
          JWT_SECRET: 'a'.repeat(32),
          NODE_ENV: 'test',
          CORS_ORIGINS: 'https://allowed.example.com',
        },
        { createDb: createNodeDb, getClientIp: () => '127.0.0.1', createPasswordService },
      ),
    );

    const allowed = await app.request('/healthz', {
      headers: { origin: 'https://allowed.example.com' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com');

    const notAllowed = await app.request('/healthz', {
      headers: { origin: 'https://not-allowed.example.com' },
    });
    expect(notAllowed.headers.get('access-control-allow-origin')).toBeNull();
  });
});

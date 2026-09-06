import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import type { Role } from '@topicmatrix/shared';
import type { User } from '@topicmatrix/db';

async function createActiveUser(
  ctx: ApiTestContext,
  password: string,
  overrides: { role?: Role; mustChangePassword?: boolean } = {},
): Promise<User> {
  const passwordService = createPasswordService({ memoryKib: 19456, iterations: 2 });
  const passwordHash = await passwordService.hash(password);
  const user = await ctx.fixtures.createUser({
    passwordHash,
    ...(overrides.role !== undefined ? { role: overrides.role } : {}),
    ...(overrides.mustChangePassword !== undefined
      ? { mustChangePassword: overrides.mustChangePassword }
      : {}),
  });
  await ctx.db.userSettings.createDefault(user.id);
  return user;
}

function cookieValue(res: Response, name: string): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('missing set-cookie header');
  const value = new RegExp(`${name}=([^;]+)`).exec(setCookie)?.[1];
  if (!value) throw new Error(`cookie ${name} missing from ${setCookie}`);
  return value;
}

interface LoginResponseBody {
  accessToken: string;
  user: { email: string; mustChangePassword: boolean };
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function loginRequest(email: string, password: string): Request {
  return new Request('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('auth routes', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('logs in with correct credentials and returns an access token + refresh cookie', async () => {
    const user = await createActiveUser(ctx, 'correct-horse-battery');
    const res = await ctx.app.request(loginRequest(user.email, 'correct-horse-battery'));

    expect(res.status).toBe(200);
    const body = await readJson<LoginResponseBody & { user: { passwordHash?: string } }>(res);
    expect(body.accessToken).toBeTruthy();
    expect(body.user.email).toBe(user.email);
    expect(body.user.passwordHash).toBeUndefined();
    expect(res.headers.get('set-cookie')).toMatch(/refreshToken=/);
  });

  it('returns the same generic error and status for an unknown email and a wrong password', async () => {
    const user = await createActiveUser(ctx, 'correct-horse-battery');

    const unknown = await ctx.app.request(loginRequest('nobody@example.com', 'whatever12345'));
    const wrongPassword = await ctx.app.request(loginRequest(user.email, 'wrong-password-here'));

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrongPassword.json());
  });

  it('rejects login for a disabled account with the same generic error', async () => {
    const user = await createActiveUser(ctx, 'correct-horse-battery');
    await ctx.db.users.update(user.id, { isActive: false });

    const res = await ctx.app.request(loginRequest(user.email, 'correct-horse-battery'));
    expect(res.status).toBe(401);
  });

  it('full cycle: login -> refresh rotates the cookie and rejects reuse of the old one -> logout revokes it', async () => {
    const user = await createActiveUser(ctx, 'correct-horse-battery');
    const login = await ctx.app.request(loginRequest(user.email, 'correct-horse-battery'));
    const firstToken = cookieValue(login, 'refreshToken');
    const { accessToken } = await readJson<LoginResponseBody>(login);

    const refreshed = await ctx.app.request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refreshToken=${firstToken}` },
    });
    expect(refreshed.status).toBe(200);
    const secondToken = cookieValue(refreshed, 'refreshToken');
    expect(secondToken).not.toBe(firstToken);

    const reuseOldToken = await ctx.app.request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refreshToken=${firstToken}` },
    });
    expect(reuseOldToken.status).toBe(401);

    const logout = await ctx.app.request('/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, cookie: `refreshToken=${secondToken}` },
    });
    expect(logout.status).toBe(200);

    const afterLogout = await ctx.app.request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refreshToken=${secondToken}` },
    });
    expect(afterLogout.status).toBe(401);
  });

  it('change-password updates the hash, clears mustChangePassword, and revokes existing refresh tokens', async () => {
    const user = await createActiveUser(ctx, 'old-password-123', { mustChangePassword: true });
    const login = await ctx.app.request(loginRequest(user.email, 'old-password-123'));
    const firstToken = cookieValue(login, 'refreshToken');
    const { accessToken } = await readJson<LoginResponseBody>(login);

    const changed = await ctx.app.request('/auth/change-password', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'old-password-123',
        newPassword: 'new-password-456',
      }),
    });
    expect(changed.status).toBe(200);

    const oldRefreshNowRejected = await ctx.app.request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refreshToken=${firstToken}` },
    });
    expect(oldRefreshNowRejected.status).toBe(401);

    expect((await ctx.app.request(loginRequest(user.email, 'old-password-123'))).status).toBe(401);
    expect((await ctx.app.request(loginRequest(user.email, 'new-password-456'))).status).toBe(200);
  });

  it('rejects a change-password request with an incorrect current password', async () => {
    const user = await createActiveUser(ctx, 'correct-horse-battery');
    const login = await ctx.app.request(loginRequest(user.email, 'correct-horse-battery'));
    const { accessToken } = await readJson<LoginResponseBody>(login);

    const res = await ctx.app.request('/auth/change-password', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'not-the-current-password',
        newPassword: 'new-password-456',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rate-limits login, returning 429 on the 11th attempt in the window', async () => {
    const user = await createActiveUser(ctx, 'correct-horse-battery');

    for (let i = 0; i < 10; i += 1) {
      const res = await ctx.app.request(loginRequest(user.email, 'wrong-password'));
      expect(res.status).toBe(401);
    }

    const eleventh = await ctx.app.request(loginRequest(user.email, 'wrong-password'));
    expect(eleventh.status).toBe(429);
  }, 30_000);
});

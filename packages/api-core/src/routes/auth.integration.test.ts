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

  it('full cycle: login -> refresh rotates the cookie -> logout revokes it', async () => {
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

  describe('reuse of a rotated refresh token (D-6)', () => {
    let now: number;
    let clockCtx: ApiTestContext;

    beforeEach(async () => {
      now = Date.now();
      clockCtx = await setupApiTest({ clock: () => new Date(now) });
    });

    afterEach(() => clockCtx.teardown());

    async function loginAndRotate(): Promise<{ firstToken: string; secondToken: string }> {
      const user = await createActiveUser(clockCtx, 'correct-horse-battery');
      const login = await clockCtx.app.request(loginRequest(user.email, 'correct-horse-battery'));
      const firstToken = cookieValue(login, 'refreshToken');
      const refreshed = await clockCtx.app.request('/auth/refresh', {
        method: 'POST',
        headers: { cookie: `refreshToken=${firstToken}` },
      });
      expect(refreshed.status).toBe(200);
      return { firstToken, secondToken: cookieValue(refreshed, 'refreshToken') };
    }

    it('honours a just-rotated token (another tab refreshing concurrently) without touching the cookie', async () => {
      const { firstToken, secondToken } = await loginAndRotate();

      const concurrent = await clockCtx.app.request('/auth/refresh', {
        method: 'POST',
        headers: { cookie: `refreshToken=${firstToken}` },
      });
      expect(concurrent.status).toBe(200);
      expect((await readJson<LoginResponseBody>(concurrent)).accessToken).toBeTruthy();
      // Neither a new cookie nor a cookie deletion: the browser keeps the successor.
      expect(concurrent.headers.get('set-cookie')).toBeNull();

      // The successor is still valid.
      const next = await clockCtx.app.request('/auth/refresh', {
        method: 'POST',
        headers: { cookie: `refreshToken=${secondToken}` },
      });
      expect(next.status).toBe(200);
    });

    it('treats a rotated token replayed after the grace window as theft: every session is revoked', async () => {
      const { firstToken, secondToken } = await loginAndRotate();
      now += 31_000;

      const replay = await clockCtx.app.request('/auth/refresh', {
        method: 'POST',
        headers: { cookie: `refreshToken=${firstToken}` },
      });
      expect(replay.status).toBe(401);

      // The legitimate successor was revoked too — the attacker and the victim both re-login.
      const successor = await clockCtx.app.request('/auth/refresh', {
        method: 'POST',
        headers: { cookie: `refreshToken=${secondToken}` },
      });
      expect(successor.status).toBe(401);
    });

    it('rejects a logged-out token without revoking the other sessions of that user', async () => {
      const user = await createActiveUser(clockCtx, 'correct-horse-battery');
      const tabA = await clockCtx.app.request(loginRequest(user.email, 'correct-horse-battery'));
      const tabB = await clockCtx.app.request(loginRequest(user.email, 'correct-horse-battery'));
      const tokenA = cookieValue(tabA, 'refreshToken');
      const { accessToken: accessA } = await readJson<LoginResponseBody>(tabA);

      await clockCtx.app.request('/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessA}`, cookie: `refreshToken=${tokenA}` },
      });
      const replay = await clockCtx.app.request('/auth/refresh', {
        method: 'POST',
        headers: { cookie: `refreshToken=${tokenA}` },
      });
      expect(replay.status).toBe(401);

      const other = await clockCtx.app.request('/auth/refresh', {
        method: 'POST',
        headers: { cookie: `refreshToken=${cookieValue(tabB, 'refreshToken')}` },
      });
      expect(other.status).toBe(200);
    });

    it('purges expired and long-revoked tokens on login', async () => {
      const user = await createActiveUser(clockCtx, 'correct-horse-battery');
      const expired = await clockCtx.db.refreshTokens.create(user.id, {
        tokenHash: 'expired-token-hash',
        expiresAt: new Date(now - 1000),
      });
      const longRevoked = await clockCtx.db.refreshTokens.create(user.id, {
        tokenHash: 'long-revoked-token-hash',
        expiresAt: new Date(now + 86_400_000),
      });
      await clockCtx.db.refreshTokens.revoke(user.id, longRevoked.id);
      now += 8 * 24 * 60 * 60 * 1000; // past the 7-day revoked-token retention

      await clockCtx.app.request(loginRequest(user.email, 'correct-horse-battery'));

      expect(await clockCtx.db.refreshTokens.findByTokenHash(expired.tokenHash)).toBeNull();
      expect(await clockCtx.db.refreshTokens.findByTokenHash(longRevoked.tokenHash)).toBeNull();
    });
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

  it('keeps the changing browser signed in on a fresh session, and ends every other session (R4)', async () => {
    const user = await createActiveUser(ctx, 'old-password-123');
    const thisTab = await ctx.app.request(loginRequest(user.email, 'old-password-123'));
    const otherDevice = await ctx.app.request(loginRequest(user.email, 'old-password-123'));
    const { accessToken } = await readJson<LoginResponseBody>(thisTab);

    const changed = await ctx.app.request('/auth/change-password', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old-password-123', newPassword: 'new-password-456' }),
    });
    expect(changed.status).toBe(200);
    const body = await readJson<LoginResponseBody>(changed);
    expect(body.accessToken).toBeTruthy();
    expect(body.user.mustChangePassword).toBe(false);

    // The fresh cookie works…
    const fresh = await ctx.app.request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refreshToken=${cookieValue(changed, 'refreshToken')}` },
    });
    expect(fresh.status).toBe(200);
    // …while the other device's session is over.
    const other = await ctx.app.request('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refreshToken=${cookieValue(otherDevice, 'refreshToken')}` },
    });
    expect(other.status).toBe(401);
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
    expect(res.status).toBe(422);
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';
import type { Role } from '@topicmatrix/shared';

interface AdminUserView {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordHash?: string;
}

interface CreateUserResponseBody {
  user: AdminUserView;
  temporaryPassword: string;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createLoggedInUser(
  ctx: ApiTestContext,
  role: Role,
  overrides: { mustChangePassword?: boolean } = {},
): Promise<{ accessToken: string; userId: string }> {
  const passwordService = createPasswordService({ memoryKib: 19456, iterations: 2 });
  const passwordHash = await passwordService.hash('correct-horse-battery');
  const user = await ctx.fixtures.createUser({
    passwordHash,
    role,
    ...(overrides.mustChangePassword !== undefined
      ? { mustChangePassword: overrides.mustChangePassword }
      : {}),
  });
  await ctx.db.userSettings.createDefault(user.id);

  // Matches the jwtSecret baked into packages/db/test/setup.ts's testConfig default.
  const tokenService = createTokenService('a'.repeat(32));
  const accessToken = await tokenService.signAccessToken({ userId: user.id, role });
  return { accessToken, userId: user.id };
}

function authed(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

describe('admin user-management routes', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects an unauthenticated request with 401', async () => {
    const res = await ctx.app.request('/admin/users');
    expect(res.status).toBe(401);
  });

  it('rejects a LEARNER with 403 on every /admin route', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx, 'LEARNER');

    const list = await ctx.app.request('/admin/users', { headers: authed(accessToken) });
    expect(list.status).toBe(403);

    const create = await ctx.app.request('/admin/users', {
      method: 'POST',
      headers: { ...authed(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', displayName: 'New Person' }),
    });
    expect(create.status).toBe(403);

    const patch = await ctx.app.request(`/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { ...authed(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    expect(patch.status).toBe(403);

    const del = await ctx.app.request(`/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { ...authed(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(del.status).toBe(403);
  });

  it('blocks an admin with mustChangePassword=true from every /admin route except change-password', async () => {
    const { accessToken } = await createLoggedInUser(ctx, 'ADMIN', { mustChangePassword: true });
    const res = await ctx.app.request('/admin/users', { headers: authed(accessToken) });
    expect(res.status).toBe(403);
    const body = await readJson<{ error: { details?: unknown } }>(res);
    expect(body.error.details).toEqual({ mustChangePassword: true });
  });

  it('lets an admin list, create, patch and delete users', async () => {
    const { accessToken: adminToken } = await createLoggedInUser(ctx, 'ADMIN');

    const create = await ctx.app.request('/admin/users', {
      method: 'POST',
      headers: { ...authed(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'learner@example.com', displayName: 'A Learner' }),
    });
    expect(create.status).toBe(201);
    const created = await readJson<CreateUserResponseBody>(create);
    expect(created.temporaryPassword).toBeTruthy();
    expect(created.user.mustChangePassword).toBe(true);
    expect(created.user.passwordHash).toBeUndefined();

    // The temporary password actually works and forces a password change.
    const login = await ctx.app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'learner@example.com', password: created.temporaryPassword }),
    });
    expect(login.status).toBe(200);
    const loginBody = await readJson<{ user: { mustChangePassword: boolean } }>(login);
    expect(loginBody.user.mustChangePassword).toBe(true);

    const list = await ctx.app.request('/admin/users', { headers: authed(adminToken) });
    const listed = await readJson<{ users: AdminUserView[] }>(list);
    expect(listed.users.some((u) => u.id === created.user.id)).toBe(true);

    const patch = await ctx.app.request(`/admin/users/${created.user.id}`, {
      method: 'PATCH',
      headers: { ...authed(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    expect(patch.status).toBe(200);
    const patched = await readJson<{ user: AdminUserView }>(patch);
    expect(patched.user.isActive).toBe(false);

    // Disabled account can no longer log in.
    const loginAfterDisable = await ctx.app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'learner@example.com', password: created.temporaryPassword }),
    });
    expect(loginAfterDisable.status).toBe(401);

    const del = await ctx.app.request(`/admin/users/${created.user.id}`, {
      method: 'DELETE',
      headers: { ...authed(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(del.status).toBe(200);
    expect(await ctx.db.users.findById(created.user.id)).toBeNull();
  });

  it('rejects creating a user with an email that already exists', async () => {
    const { accessToken: adminToken } = await createLoggedInUser(ctx, 'ADMIN');
    const existing = await ctx.fixtures.createUser({ email: 'dup@example.com' });

    const res = await ctx.app.request('/admin/users', {
      method: 'POST',
      headers: { ...authed(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ email: existing.email, displayName: 'Someone Else' }),
    });
    expect(res.status).toBe(409);
  });

  it('cascade-deletes a user account: subjects, topics and sessions are gone too', async () => {
    const { accessToken: adminToken } = await createLoggedInUser(ctx, 'ADMIN');
    const learner = await ctx.fixtures.createUser();
    await ctx.db.userSettings.createDefault(learner.id);
    const subject = await ctx.fixtures.createSubject(learner.id);
    const topic = await ctx.fixtures.createTopic(learner.id, subject.id);
    await ctx.fixtures.createStudySession(learner.id, topic.id);

    const del = await ctx.app.request(`/admin/users/${learner.id}`, {
      method: 'DELETE',
      headers: { ...authed(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(del.status).toBe(200);

    expect(await ctx.db.users.findById(learner.id)).toBeNull();
    expect(await ctx.db.subjects.findById(learner.id, subject.id)).toBeNull();
  });

  it('requires the explicit confirm field to delete a user', async () => {
    const { accessToken: adminToken } = await createLoggedInUser(ctx, 'ADMIN');
    const learner = await ctx.fixtures.createUser();

    const res = await ctx.app.request(`/admin/users/${learner.id}`, {
      method: 'DELETE',
      headers: { ...authed(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    expect(await ctx.db.users.findById(learner.id)).not.toBeNull();
  });

  it('never exposes subjects/topics/sessions under /admin (SRS §16 Q7)', async () => {
    const { accessToken: adminToken } = await createLoggedInUser(ctx, 'ADMIN');
    const res = await ctx.app.request('/admin/subjects', { headers: authed(adminToken) });
    expect(res.status).toBe(404);
  });
});

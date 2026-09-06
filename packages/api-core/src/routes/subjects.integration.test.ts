import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

interface SubjectView {
  id: string;
  name: string;
  isArchived: boolean;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createLoggedInUser(ctx: ApiTestContext): Promise<{ accessToken: string; userId: string }> {
  const passwordService = createPasswordService({ memoryKib: 19456, iterations: 2 });
  const passwordHash = await passwordService.hash('correct-horse-battery');
  const user = await ctx.fixtures.createUser({ passwordHash, role: 'LEARNER' });
  await ctx.db.userSettings.createDefault(user.id);

  const tokenService = createTokenService('a'.repeat(32));
  const accessToken = await tokenService.signAccessToken({ userId: user.id, role: 'LEARNER' });
  return { accessToken, userId: user.id };
}

function authed(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}

describe('subject routes', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects an unauthenticated request with 401', async () => {
    const res = await ctx.app.request('/subjects');
    expect(res.status).toBe(401);
  });

  it('creates, lists, reads, updates and deletes a subject', async () => {
    const { accessToken } = await createLoggedInUser(ctx);

    const create = await ctx.app.request('/subjects', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ name: 'Mathematics' }),
    });
    expect(create.status).toBe(201);
    const { subject } = await readJson<{ subject: SubjectView }>(create);
    expect(subject.name).toBe('Mathematics');

    const list = await ctx.app.request('/subjects', { headers: authed(accessToken) });
    const { subjects } = await readJson<{ subjects: SubjectView[] }>(list);
    expect(subjects.map((s) => s.id)).toEqual([subject.id]);

    const get = await ctx.app.request(`/subjects/${subject.id}`, { headers: authed(accessToken) });
    expect(get.status).toBe(200);

    const patch = await ctx.app.request(`/subjects/${subject.id}`, {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ isArchived: true }),
    });
    expect(patch.status).toBe(200);
    const { subject: patched } = await readJson<{ subject: SubjectView }>(patch);
    expect(patched.isArchived).toBe(true);

    const del = await ctx.app.request(`/subjects/${subject.id}`, {
      method: 'DELETE',
      headers: authed(accessToken),
      body: JSON.stringify({ confirm: true }),
    });
    expect(del.status).toBe(200);
    expect((await ctx.app.request(`/subjects/${subject.id}`, { headers: authed(accessToken) })).status).toBe(
      404,
    );
  });

  it('rejects a create request that fails validation', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/subjects', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects deleting a subject without the explicit confirm field', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const create = await ctx.app.request('/subjects', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ name: 'Physics' }),
    });
    const { subject } = await readJson<{ subject: SubjectView }>(create);

    const del = await ctx.app.request(`/subjects/${subject.id}`, {
      method: 'DELETE',
      headers: authed(accessToken),
      body: JSON.stringify({}),
    });
    expect(del.status).toBe(422);
  });

  it("returns 404 (not 403) for another user's subject on every route", async () => {
    const owner = await createLoggedInUser(ctx);
    const intruder = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(owner.userId);

    const get = await ctx.app.request(`/subjects/${subject.id}`, { headers: authed(intruder.accessToken) });
    expect(get.status).toBe(404);

    const patch = await ctx.app.request(`/subjects/${subject.id}`, {
      method: 'PATCH',
      headers: authed(intruder.accessToken),
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(patch.status).toBe(404);

    const del = await ctx.app.request(`/subjects/${subject.id}`, {
      method: 'DELETE',
      headers: authed(intruder.accessToken),
      body: JSON.stringify({ confirm: true }),
    });
    expect(del.status).toBe(404);

    const tree = await ctx.app.request(`/subjects/${subject.id}/tree`, {
      headers: authed(intruder.accessToken),
    });
    expect(tree.status).toBe(404);

    expect(await ctx.db.subjects.findById(owner.userId, subject.id)).not.toBeNull();
  });

  it('enforces case-insensitive name uniqueness per user with 409', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    await ctx.app.request('/subjects', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ name: 'Chemistry' }),
    });
    const conflict = await ctx.app.request('/subjects', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ name: 'chemistry' }),
    });
    expect(conflict.status).toBe(409);
  });

  it('GET /subjects/:id/tree returns a nested tree with placeholder metrics', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const [root, child] = await ctx.fixtures.createTopicChain(userId, subject.id, 2);

    const res = await ctx.app.request(`/subjects/${subject.id}/tree`, { headers: authed(accessToken) });
    expect(res.status).toBe(200);
    const body = await readJson<{
      tree: { id: string; metrics: { ownScore: null }; children: { id: string }[] }[];
    }>(res);

    expect(body.tree).toHaveLength(1);
    expect(body.tree[0]?.id).toBe(root?.id);
    expect(body.tree[0]?.metrics.ownScore).toBeNull();
    expect(body.tree[0]?.children[0]?.id).toBe(child?.id);
  });
});

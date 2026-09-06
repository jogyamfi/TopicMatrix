import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

interface TagView {
  id: string;
  name: string;
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

describe('tag routes (FR-3.9)', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects an unauthenticated request with 401', async () => {
    expect((await ctx.app.request('/tags')).status).toBe(401);
  });

  it('creates, lists and deletes a tag', async () => {
    const { accessToken } = await createLoggedInUser(ctx);

    const create = await ctx.app.request('/tags', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ name: 'exam-critical' }),
    });
    expect(create.status).toBe(201);
    const { tag } = await readJson<{ tag: TagView }>(create);

    const list = await ctx.app.request('/tags', { headers: authed(accessToken) });
    expect((await readJson<{ tags: TagView[] }>(list)).tags.map((t) => t.id)).toEqual([tag.id]);

    const del = await ctx.app.request(`/tags/${tag.id}`, { method: 'DELETE', headers: authed(accessToken) });
    expect(del.status).toBe(200);
    expect((await readJson<{ tags: TagView[] }>(await ctx.app.request('/tags', { headers: authed(accessToken) }))).tags).toHaveLength(0);
  });

  it('attaches and detaches a tag on a topic', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);
    const tag = await ctx.db.tags.create(userId, 'revision');

    const attach = await ctx.app.request(`/topics/${topic.id}/tags/${tag.id}`, {
      method: 'POST',
      headers: authed(accessToken),
    });
    expect(attach.status).toBe(200);

    const tagsForTopic = await ctx.app.request(`/topics/${topic.id}/tags`, { headers: authed(accessToken) });
    expect((await readJson<{ tags: TagView[] }>(tagsForTopic)).tags.map((t) => t.id)).toEqual([tag.id]);

    const detach = await ctx.app.request(`/topics/${topic.id}/tags/${tag.id}`, {
      method: 'DELETE',
      headers: authed(accessToken),
    });
    expect(detach.status).toBe(200);
    const afterDetach = await ctx.app.request(`/topics/${topic.id}/tags`, { headers: authed(accessToken) });
    expect((await readJson<{ tags: TagView[] }>(afterDetach)).tags).toHaveLength(0);
  });

  it('cross-subject filter: GET /tags/:id/topics returns topics from every subject carrying the tag', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subjectA = await ctx.fixtures.createSubject(userId);
    const subjectB = await ctx.fixtures.createSubject(userId);
    const topicA = await ctx.fixtures.createTopic(userId, subjectA.id);
    const topicB = await ctx.fixtures.createTopic(userId, subjectB.id);
    const tag = await ctx.db.tags.create(userId, 'shared-tag');
    await ctx.db.tags.attachToTopic(userId, topicA.id, tag.id);
    await ctx.db.tags.attachToTopic(userId, topicB.id, tag.id);

    const res = await ctx.app.request(`/tags/${tag.id}/topics`, { headers: authed(accessToken) });
    expect(res.status).toBe(200);
    const { topics } = await readJson<{ topics: { id: string; subjectId: string }[] }>(res);
    expect(topics.map((t) => t.id).sort()).toEqual([topicA.id, topicB.id].sort());
  });

  it("rejects attaching another user's tag to your topic", async () => {
    const owner = await createLoggedInUser(ctx);
    const intruder = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(owner.userId);
    const topic = await ctx.fixtures.createTopic(owner.userId, subject.id);
    const tag = await ctx.db.tags.create(intruder.userId, 'not-yours');

    const res = await ctx.app.request(`/topics/${topic.id}/tags/${tag.id}`, {
      method: 'POST',
      headers: authed(owner.accessToken),
    });
    expect(res.status).toBe(404);
  });
});

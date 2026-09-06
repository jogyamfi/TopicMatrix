import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

interface TopicView {
  id: string;
  subjectId: string;
  parentId: string | null;
  name: string;
  depth: number;
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

describe('topic routes', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects an unauthenticated request with 401', async () => {
    const res = await ctx.app.request('/topics?subjectId=anything');
    expect(res.status).toBe(401);
  });

  it('creates, lists (by subject), reads, updates and deletes a topic', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);

    const create = await ctx.app.request('/topics', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ subjectId: subject.id, name: 'Algebra' }),
    });
    expect(create.status).toBe(201);
    const { topic } = await readJson<{ topic: TopicView }>(create);
    expect(topic.name).toBe('Algebra');
    expect(topic.depth).toBe(0);

    const list = await ctx.app.request(`/topics?subjectId=${subject.id}`, { headers: authed(accessToken) });
    const { topics } = await readJson<{ topics: TopicView[] }>(list);
    expect(topics.map((t) => t.id)).toEqual([topic.id]);

    const patch = await ctx.app.request(`/topics/${topic.id}`, {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ name: 'Advanced Algebra' }),
    });
    expect(patch.status).toBe(200);
    expect((await readJson<{ topic: TopicView }>(patch)).topic.name).toBe('Advanced Algebra');

    const del = await ctx.app.request(`/topics/${topic.id}`, {
      method: 'DELETE',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'cascade' }),
    });
    expect(del.status).toBe(200);
    expect((await ctx.app.request(`/topics/${topic.id}`, { headers: authed(accessToken) })).status).toBe(404);
  });

  it('requires the subjectId query parameter on GET /topics', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/topics', { headers: authed(accessToken) });
    expect(res.status).toBe(400);
  });

  it('rejects a sibling with a duplicate (normalised) name with 409', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    await ctx.app.request('/topics', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ subjectId: subject.id, name: 'Geometry' }),
    });
    const conflict = await ctx.app.request('/topics', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ subjectId: subject.id, name: 'geometry' }),
    });
    expect(conflict.status).toBe(409);
  });

  it("returns 404 (not 403) for another user's topic on every route", async () => {
    const owner = await createLoggedInUser(ctx);
    const intruder = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(owner.userId);
    const topic = await ctx.fixtures.createTopic(owner.userId, subject.id);

    const get = await ctx.app.request(`/topics/${topic.id}`, { headers: authed(intruder.accessToken) });
    expect(get.status).toBe(404);

    const patch = await ctx.app.request(`/topics/${topic.id}`, {
      method: 'PATCH',
      headers: authed(intruder.accessToken),
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(patch.status).toBe(404);

    const move = await ctx.app.request(`/topics/${topic.id}/move`, {
      method: 'POST',
      headers: authed(intruder.accessToken),
      body: JSON.stringify({ parentId: null }),
    });
    expect(move.status).toBe(404);

    const del = await ctx.app.request(`/topics/${topic.id}`, {
      method: 'DELETE',
      headers: authed(intruder.accessToken),
      body: JSON.stringify({ mode: 'cascade' }),
    });
    expect(del.status).toBe(404);

    expect(await ctx.db.topics.findById(owner.userId, topic.id)).not.toBeNull();
  });

  describe('POST /topics/:id/move', () => {
    it('re-parents a topic, including across subjects', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subjectA = await ctx.fixtures.createSubject(userId);
      const subjectB = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subjectA.id);
      const newParent = await ctx.fixtures.createTopic(userId, subjectB.id);

      const res = await ctx.app.request(`/topics/${topic.id}/move`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ parentId: newParent.id }),
      });
      expect(res.status).toBe(200);
      const { topic: moved } = await readJson<{ topic: TopicView }>(res);
      expect(moved.subjectId).toBe(subjectB.id);
      expect(moved.parentId).toBe(newParent.id);
      expect(moved.depth).toBe(1);
    });

    it('rejects a cycle (moving a topic under its own descendant) with TOPIC_CYCLE', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const [parent, child] = await ctx.fixtures.createTopicChain(userId, subject.id, 2);

      const res = await ctx.app.request(`/topics/${parent?.id}/move`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ parentId: child?.id }),
      });
      expect(res.status).toBe(400);
      const body = await readJson<{ error: { code: string } }>(res);
      expect(body.error.code).toBe('TOPIC_CYCLE');
    });
  });

  describe('DELETE /topics/:id (mode=promote)', () => {
    it("re-parents children to the deleted topic's parent", async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const [grandparent, parent, child] = await ctx.fixtures.createTopicChain(userId, subject.id, 3);

      const res = await ctx.app.request(`/topics/${parent?.id}`, {
        method: 'DELETE',
        headers: authed(accessToken),
        body: JSON.stringify({ mode: 'promote' }),
      });
      expect(res.status).toBe(200);

      expect(await ctx.db.topics.findById(userId, parent?.id as string)).toBeNull();
      const promotedChild = await ctx.db.topics.findById(userId, child?.id as string);
      expect(promotedChild?.parentId).toBe(grandparent?.id);
    });
  });
});

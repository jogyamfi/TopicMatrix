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

  describe('R4', () => {
    async function createTag(accessToken: string, name: string): Promise<TagView> {
      const res = await ctx.app.request('/tags', {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ name }),
      });
      return (await readJson<{ tag: TagView }>(res)).tag;
    }

    it('deletes a tag that is attached to topics, leaving the topics alone', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);
      const tag = await createTag(accessToken, 'exam');
      await ctx.app.request(`/topics/${topic.id}/tags/${tag.id}`, { method: 'POST', headers: authed(accessToken) });

      const del = await ctx.app.request(`/tags/${tag.id}`, { method: 'DELETE', headers: authed(accessToken) });
      expect(del.status).toBe(200);
      expect(await ctx.db.tags.findById(userId, tag.id)).toBeNull();
      expect(await ctx.db.topics.findById(userId, topic.id)).not.toBeNull();
    });

    it('renames a tag, rejecting a name another tag already has (case-insensitively)', async () => {
      const { accessToken } = await createLoggedInUser(ctx);
      const tag = await createTag(accessToken, 'exam');
      await createTag(accessToken, 'Revision');

      const renamed = await ctx.app.request(`/tags/${tag.id}`, {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ name: 'Exam prep' }),
      });
      expect(renamed.status).toBe(200);
      expect((await readJson<{ tag: TagView }>(renamed)).tag.name).toBe('Exam prep');

      const clash = await ctx.app.request(`/tags/${tag.id}`, {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ name: 'revision' }),
      });
      expect(clash.status).toBe(409);
    });

    it("cannot rename another user's tag", async () => {
      const owner = await createLoggedInUser(ctx);
      const intruder = await createLoggedInUser(ctx);
      const tag = await createTag(owner.accessToken, 'mine');
      const res = await ctx.app.request(`/tags/${tag.id}`, {
        method: 'PATCH',
        headers: authed(intruder.accessToken),
        body: JSON.stringify({ name: 'theirs' }),
      });
      expect(res.status).toBe(404);
    });

    it('lists tagged topics with their live score and health', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId, { name: 'Maths' });
      const studied = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Algebra' });
      const fresh = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Geometry' });
      await ctx.fixtures.createTopic(userId, subject.id, { name: 'Untagged' });
      const tag = await createTag(accessToken, 'exam');
      for (const topicId of [studied.id, fresh.id]) {
        await ctx.app.request(`/topics/${topicId}/tags/${tag.id}`, { method: 'POST', headers: authed(accessToken) });
      }
      await ctx.app.request(`/topics/${studied.id}/sessions`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ questionsAttempted: 10, questionsCorrect: 8, confidence: 4 }),
      });

      const res = await ctx.app.request(`/tags/${tag.id}/topics`, { headers: authed(accessToken) });
      const { topics } = await readJson<{
        topics: { id: string; name: string; subjectName: string; score: number | null; healthStatus: string }[];
      }>(res);
      expect(topics.map((t) => t.name).sort()).toEqual(['Algebra', 'Geometry']);
      const algebra = topics.find((t) => t.id === studied.id);
      expect(algebra?.score).toBeGreaterThan(0);
      expect(algebra?.subjectName).toBe('Maths');
      expect(topics.find((t) => t.id === fresh.id)?.healthStatus).toBe('notStarted');
    });
  });

  describe('GET /topics/search (R4)', () => {
    interface SearchResult {
      id: string;
      name: string;
      subjectName: string;
      ancestors: string[];
    }

    async function search(accessToken: string, q: string): Promise<SearchResult[]> {
      const res = await ctx.app.request(`/topics/search?q=${encodeURIComponent(q)}`, { headers: authed(accessToken) });
      expect(res.status).toBe(200);
      return (await readJson<{ topics: SearchResult[] }>(res)).topics;
    }

    it('finds topics across subjects case-insensitively, with their ancestors, prefix matches first', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const maths = await ctx.fixtures.createSubject(userId, { name: 'Maths' });
      const physics = await ctx.fixtures.createSubject(userId, { name: 'Physics' });
      const algebra = await ctx.fixtures.createTopic(userId, maths.id, { name: 'Algebra' });
      await ctx.db.topics.create(userId, { subjectId: maths.id, parentId: algebra.id, name: 'Quadratic equations' });
      await ctx.db.topics.create(userId, { subjectId: physics.id, name: 'Equations of motion' });

      const results = await search(accessToken, 'EQUATION');
      expect(results.map((r) => r.name)).toEqual(['Equations of motion', 'Quadratic equations']);
      expect(results.find((r) => r.name === 'Quadratic equations')).toMatchObject({
        subjectName: 'Maths',
        ancestors: ['Algebra'],
      });
    });

    it("never returns another user's topics or topics in archived subjects", async () => {
      const me = await createLoggedInUser(ctx);
      const someoneElse = await createLoggedInUser(ctx);
      const mine = await ctx.fixtures.createSubject(me.userId);
      const archived = await ctx.fixtures.createSubject(me.userId);
      await ctx.db.subjects.update(me.userId, archived.id, { isArchived: true });
      const theirs = await ctx.fixtures.createSubject(someoneElse.userId);
      await ctx.fixtures.createTopic(me.userId, mine.id, { name: 'Thermodynamics' });
      await ctx.fixtures.createTopic(me.userId, archived.id, { name: 'Thermo (old)' });
      await ctx.fixtures.createTopic(someoneElse.userId, theirs.id, { name: 'Thermo secrets' });

      expect((await search(me.accessToken, 'thermo')).map((r) => r.name)).toEqual(['Thermodynamics']);
    });

    it('returns nothing for an empty query', async () => {
      const { accessToken } = await createLoggedInUser(ctx);
      expect(await search(accessToken, '   ')).toEqual([]);
    });
  });
});

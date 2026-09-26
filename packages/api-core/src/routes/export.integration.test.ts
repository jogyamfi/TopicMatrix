import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPORT_FORMAT_VERSION } from '@topicmatrix/db';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

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

describe('export routes (FR-9.1-FR-9.3)', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects an unauthenticated request with 401', async () => {
    expect((await ctx.app.request('/export/json')).status).toBe(401);
    expect((await ctx.app.request('/export/sessions.csv')).status).toBe(401);
  });

  it('produces a complete, versioned JSON export', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId, { name: 'Maths' });
    const topic = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Algebra' });
    await ctx.fixtures.createStudySession(userId, topic.id, { questionsAttempted: 10, questionsCorrect: 7 });
    const tag = await ctx.db.tags.create(userId, 'exam');
    await ctx.db.tags.attachToTopic(userId, topic.id, tag.id);

    const res = await ctx.app.request('/export/json', { headers: authed(accessToken) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const body = (await res.json()) as {
      version: number;
      user: { id: string };
      subjects: { id: string; name: string }[];
      topics: { id: string; name: string }[];
      studySessions: unknown[];
      tags: { id: string; name: string }[];
      topicTags: { topicId: string; tagId: string }[];
    };
    expect(body.version).toBe(EXPORT_FORMAT_VERSION);
    expect(EXPORT_FORMAT_VERSION).toBe(2);
    expect(body.user.id).toBe(userId);
    expect(body.subjects.map((s) => s.name)).toEqual(['Maths']);
    expect(body.topics.map((t) => t.name)).toEqual(['Algebra']);
    expect(body.studySessions).toHaveLength(1);
    expect(body.tags.map((t) => t.name)).toEqual(['exam']);
    expect(body.topicTags).toEqual([{ topicId: topic.id, tagId: tag.id }]);
  });

  it('never includes passwordHash in the export', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/export/json', { headers: authed(accessToken) });
    const text = await res.text();
    expect(text).not.toContain('passwordHash');
  });

  it('exports sessions as CSV with a header row', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId, { name: 'Science' });
    const topic = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Physics' });
    await ctx.fixtures.createStudySession(userId, topic.id, { questionsAttempted: 5, questionsCorrect: 4 });

    const res = await ctx.app.request('/export/sessions.csv', { headers: authed(accessToken) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'studiedOn,subjectName,topicName,sourceLabel,questionsAttempted,questionsCorrect,accuracy,confidence,durationMinutes,notes',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Physics');
  });

  it('filters the CSV export by subject and date range', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subjectA = await ctx.fixtures.createSubject(userId, { name: 'A' });
    const subjectB = await ctx.fixtures.createSubject(userId, { name: 'B' });
    const topicA = await ctx.fixtures.createTopic(userId, subjectA.id);
    const topicB = await ctx.fixtures.createTopic(userId, subjectB.id);
    await ctx.fixtures.createStudySession(userId, topicA.id, { studiedOn: new Date('2026-01-10T00:00:00.000Z') });
    await ctx.fixtures.createStudySession(userId, topicB.id, { studiedOn: new Date('2026-06-10T00:00:00.000Z') });

    const bySubject = await ctx.app.request(`/export/sessions.csv?subjectId=${subjectA.id}`, {
      headers: authed(accessToken),
    });
    const bySubjectLines = (await bySubject.text()).trim().split('\r\n');
    expect(bySubjectLines).toHaveLength(2);

    const byDate = await ctx.app.request('/export/sessions.csv?from=2026-05-01&to=2026-12-31', {
      headers: authed(accessToken),
    });
    const byDateLines = (await byDate.text()).trim().split('\r\n');
    expect(byDateLines).toHaveLength(2);
  });

  it("404s filtering the CSV export by another user's subject", async () => {
    const owner = await createLoggedInUser(ctx);
    const intruder = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(owner.userId);

    const res = await ctx.app.request(`/export/sessions.csv?subjectId=${subject.id}`, {
      headers: authed(intruder.accessToken),
    });
    expect(res.status).toBe(404);
  });

  it('defuses a CSV-injection payload in a session note (\u00a711.2 A03)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);
    await ctx.fixtures.createStudySession(userId, topic.id, { notes: '=cmd|"/c calc"!A1' });

    const res = await ctx.app.request('/export/sessions.csv', { headers: authed(accessToken) });
    const text = await res.text();
    expect(text).toContain("'=cmd");
    expect(text).not.toMatch(/,=cmd/);
  });
});

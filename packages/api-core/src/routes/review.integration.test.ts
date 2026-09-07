import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, startOfUserDay } from '@topicmatrix/shared';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

interface ReviewQueueItemView {
  topicId: string;
  subjectId: string;
  score: number | null;
  healthStatus: string;
  overdueDays: number;
  nextReviewOn: string | null;
  accuracyTrend: 'up' | 'down' | 'flat' | null;
}

interface ReviewQueueResponse {
  overdue: ReviewQueueItemView[];
  dueToday: ReviewQueueItemView[];
  dueNext7Days: ReviewQueueItemView[];
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

/** Matches the default UserSettings row (Europe/London, day-start 04:00) every fixture user gets. */
function today(): Date {
  return startOfUserDay(new Date(), 'Europe/London', 4);
}

/**
 * Sets up a topic with exactly one session studied "now" (so the recency component is exactly
 * 1, per computeCompetencyScore's `exp(-deltaT/interval)`) and an explicit schedule \u2014 giving a
 * predictable, hand-computable score (`100 * (0.6*accuracy + 0.25*(confidence-1)/4 + 0.15)`)
 * independent of whichever scheduler would otherwise have produced `nextReviewOn`.
 */
async function createDueTopic(
  ctx: ApiTestContext,
  userId: string,
  subjectId: string,
  opts: { nextReviewOn: Date; accuracy?: number; confidence?: number; isSuspended?: boolean; topicSuspended?: boolean },
) {
  const topic = await ctx.fixtures.createTopic(userId, subjectId);
  if (opts.topicSuspended) {
    await ctx.db.topics.update(userId, topic.id, { isSuspended: true });
  }
  const attempted = 10;
  const correct = Math.round((opts.accuracy ?? 1) * attempted);
  await ctx.fixtures.createStudySession(userId, topic.id, {
    studiedOn: new Date(),
    questionsAttempted: attempted,
    questionsCorrect: correct,
    confidence: opts.confidence ?? 5,
  });
  await ctx.db.reviewSchedules.upsert(userId, topic.id, {
    algorithm: 'fsrs',
    nextReviewOn: opts.nextReviewOn,
    lastReviewedOn: new Date(),
    intervalDays: 1,
    isSuspended: opts.isSuspended ?? false,
  });
  return topic;
}

describe('review queue & launcher routes (FR-6.*, FR-7.1, delivery-plan.md P8)', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects unauthenticated requests with 401', async () => {
    expect((await ctx.app.request('/review/queue')).status).toBe(401);
    expect(
      (await ctx.app.request('/review/start', { method: 'POST', body: JSON.stringify({ mode: 'weakest' }) }))
        .status,
    ).toBe(401);
  });

  it('splits the queue into overdue / due today / due in the next 7 days (FR-7.1)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);

    const overdueWeak = await createDueTopic(ctx, userId, subject.id, {
      nextReviewOn: addDays(today(), -1),
      accuracy: 0,
      confidence: 1,
    });
    const overdueStrong = await createDueTopic(ctx, userId, subject.id, {
      nextReviewOn: addDays(today(), -5),
      accuracy: 1,
      confidence: 5,
    });
    const dueToday = await createDueTopic(ctx, userId, subject.id, { nextReviewOn: today() });
    const dueSoon = await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), 3) });
    // Excluded: too far out, suspended schedule, suspended topic, never studied.
    await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), 10) });
    await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), -2), isSuspended: true });
    await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), -2), topicSuspended: true });
    await ctx.fixtures.createTopic(userId, subject.id);

    const res = await ctx.app.request('/review/queue', { headers: authed(accessToken) });
    expect(res.status).toBe(200);
    const body = await readJson<ReviewQueueResponse>(res);

    expect(body.overdue.map((i) => i.topicId)).toEqual([overdueStrong.id, overdueWeak.id]);
    expect(body.dueToday.map((i) => i.topicId)).toEqual([dueToday.id]);
    expect(body.dueNext7Days.map((i) => i.topicId)).toEqual([dueSoon.id]);
    // Overdue days descending: the 5-day-overdue (but stronger) topic still sorts first.
    expect(body.overdue[0]?.overdueDays).toBeGreaterThan(body.overdue[1]?.overdueDays ?? 0);
  });

  it('orders overdue items by overdue days descending then competency ascending (FR-7.1)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);

    // Same overdue-days bucket boundary (both 2 days overdue) \u2014 weaker one should sort first.
    const weak = await createDueTopic(ctx, userId, subject.id, {
      nextReviewOn: addDays(today(), -2),
      accuracy: 0,
      confidence: 1,
    });
    const strong = await createDueTopic(ctx, userId, subject.id, {
      nextReviewOn: addDays(today(), -2),
      accuracy: 1,
      confidence: 5,
    });

    const res = await ctx.app.request('/review/queue', { headers: authed(accessToken) });
    const body = await readJson<ReviewQueueResponse>(res);
    expect(body.overdue.map((i) => i.topicId)).toEqual([weak.id, strong.id]);
  });

  it('never includes another user\'s topics in the queue', async () => {
    const owner = await createLoggedInUser(ctx);
    const intruder = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(owner.userId);
    await createDueTopic(ctx, owner.userId, subject.id, { nextReviewOn: addDays(today(), -1) });

    const res = await ctx.app.request('/review/queue', { headers: authed(intruder.accessToken) });
    const body = await readJson<ReviewQueueResponse>(res);
    expect(body.overdue).toHaveLength(0);
  });

  it('POST /review/start mode "subject" scopes to one subject', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subjectA = await ctx.fixtures.createSubject(userId);
    const subjectB = await ctx.fixtures.createSubject(userId);
    const topicA = await createDueTopic(ctx, userId, subjectA.id, { nextReviewOn: addDays(today(), -1) });
    await createDueTopic(ctx, userId, subjectB.id, { nextReviewOn: addDays(today(), -1) });

    const res = await ctx.app.request('/review/start', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'subject', subjectId: subjectA.id }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ items: ReviewQueueItemView[] }>(res);
    expect(body.items.map((i) => i.topicId)).toEqual([topicA.id]);
  });

  it('POST /review/start mode "topicSubtree" includes the topic and its descendants', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const root = await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), -1) });
    const child = await ctx.fixtures.createTopic(userId, subject.id, { parentId: root.id });
    await ctx.fixtures.createStudySession(userId, child.id, { studiedOn: new Date() });
    await ctx.db.reviewSchedules.upsert(userId, child.id, {
      algorithm: 'fsrs',
      nextReviewOn: addDays(today(), -1),
      lastReviewedOn: new Date(),
      intervalDays: 1,
    });
    const outsideSubject = await ctx.fixtures.createSubject(userId);
    await createDueTopic(ctx, userId, outsideSubject.id, { nextReviewOn: addDays(today(), -1) });

    const res = await ctx.app.request('/review/start', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'topicSubtree', topicId: root.id }),
    });
    const body = await readJson<{ items: ReviewQueueItemView[] }>(res);
    expect(new Set(body.items.map((i) => i.topicId))).toEqual(new Set([root.id, child.id]));
  });

  it('POST /review/start mode "weakest" orders by ascending competency across all subjects', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const weak = await createDueTopic(ctx, userId, subject.id, {
      nextReviewOn: addDays(today(), 30),
      accuracy: 0,
      confidence: 1,
    });
    const strong = await createDueTopic(ctx, userId, subject.id, {
      nextReviewOn: addDays(today(), 30),
      accuracy: 1,
      confidence: 5,
    });

    const res = await ctx.app.request('/review/start', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'weakest' }),
    });
    const body = await readJson<{ items: ReviewQueueItemView[] }>(res);
    expect(body.items.map((i) => i.topicId)).toEqual([weak.id, strong.id]);
  });

  it('POST /review/start mode "dueToday" excludes topics due later than today', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const due = await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), -1) });
    await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), 3) });

    const res = await ctx.app.request('/review/start', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'dueToday' }),
    });
    const body = await readJson<{ items: ReviewQueueItemView[] }>(res);
    expect(body.items.map((i) => i.topicId)).toEqual([due.id]);
  });

  it('filters by minScore/maxScore and caps the result by maxItems (FR-6.2, FR-6.4)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), 30), accuracy: 0, confidence: 1 }); // ~15
    const mid = await createDueTopic(ctx, userId, subject.id, {
      nextReviewOn: addDays(today(), 30),
      accuracy: 0.5,
      confidence: 3,
    }); // ~57.5
    await createDueTopic(ctx, userId, subject.id, { nextReviewOn: addDays(today(), 30), accuracy: 1, confidence: 5 }); // 100

    const res = await ctx.app.request('/review/start', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'weakest', minScore: 40, maxScore: 90 }),
    });
    const body = await readJson<{ items: ReviewQueueItemView[] }>(res);
    expect(body.items.map((i) => i.topicId)).toEqual([mid.id]);

    const capped = await ctx.app.request('/review/start', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'weakest', maxItems: 1 }),
    });
    const cappedBody = await readJson<{ items: ReviewQueueItemView[] }>(capped);
    expect(cappedBody.items).toHaveLength(1);
  });

  it('reports an accuracy trend from the two most recent sessions (FR-6.3)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);
    await ctx.fixtures.createStudySession(userId, topic.id, {
      studiedOn: addDays(new Date(), -5),
      questionsAttempted: 10,
      questionsCorrect: 5,
    });
    await ctx.fixtures.createStudySession(userId, topic.id, {
      studiedOn: new Date(),
      questionsAttempted: 10,
      questionsCorrect: 9,
    });
    await ctx.db.reviewSchedules.upsert(userId, topic.id, {
      algorithm: 'fsrs',
      nextReviewOn: addDays(today(), -1),
      lastReviewedOn: new Date(),
      intervalDays: 1,
    });

    const res = await ctx.app.request('/review/queue', { headers: authed(accessToken) });
    const body = await readJson<ReviewQueueResponse>(res);
    expect(body.overdue.find((i) => i.topicId === topic.id)?.accuracyTrend).toBe('up');
  });

  it('rejects mode "subject" without a subjectId with 422', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/review/start', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ mode: 'subject' }),
    });
    expect(res.status).toBe(422);
  });
});

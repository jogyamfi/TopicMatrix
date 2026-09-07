import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, startOfUserDay } from '@topicmatrix/shared';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

interface DashboardResponse {
  today: { topicsReviewed: number; questionsAttempted: number; accuracy: number | null; minutesStudied: number };
  streak: { currentStreak: number; longestStreak: number };
  activityCalendar: { date: string; sessionCount: number }[];
}

interface MasteryResponse {
  topics: { topicId: string; name: string; score: number | null; isProvisional: boolean }[];
}

interface HeatmapResponse {
  topics: { topicId: string; score: number | null; status: 'neverStarted' | 'neglected' | 'scored' }[];
}

interface TopicHealthResponse {
  topics: {
    topicId: string;
    score: number | null;
    healthStatus: string;
    accuracyPct: number | null;
    confidencePct: number | null;
    reviewTrend: 'up' | 'down' | 'flat' | null;
  }[];
}

interface RetentionResponse {
  events: { date: string; score: number }[];
  projection: { date: string; score: number }[];
}

interface AccuracyConfidenceResponse {
  points: { date: string; accuracy: number; confidence: number; confidenceNormalised: number }[];
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

async function logSession(
  ctx: ApiTestContext,
  accessToken: string,
  topicId: string,
  studiedOn: Date,
  opts: { questionsAttempted?: number; questionsCorrect?: number; confidence?: number; durationMinutes?: number } = {},
): Promise<Response> {
  return ctx.app.request(`/topics/${topicId}/sessions`, {
    method: 'POST',
    headers: authed(accessToken),
    body: JSON.stringify({
      studiedOn: studiedOn.toISOString().slice(0, 10),
      questionsAttempted: opts.questionsAttempted ?? 10,
      questionsCorrect: opts.questionsCorrect ?? 8,
      confidence: opts.confidence ?? 4,
      ...(opts.durationMinutes !== undefined ? { durationMinutes: opts.durationMinutes } : {}),
    }),
  });
}

describe('analytics routes (FR-7.*, delivery-plan.md P9)', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects unauthenticated requests with 401 on every route', async () => {
    for (const path of [
      '/analytics/dashboard',
      '/analytics/mastery?subjectId=x',
      '/analytics/heatmap?subjectId=x',
      '/analytics/health',
      '/analytics/retention?topicId=x',
      '/analytics/accuracy-confidence?topicId=x',
    ]) {
      expect((await ctx.app.request(path)).status).toBe(401);
    }
  });

  describe('GET /analytics/dashboard (FR-7.2, FR-7.3)', () => {
    it("summarises today's activity and computes a streak", async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topicA = await ctx.fixtures.createTopic(userId, subject.id);
      const topicB = await ctx.fixtures.createTopic(userId, subject.id);

      await logSession(ctx, accessToken, topicA.id, today(), {
        questionsAttempted: 10,
        questionsCorrect: 7,
        durationMinutes: 15,
      });
      await logSession(ctx, accessToken, topicB.id, today(), {
        questionsAttempted: 10,
        questionsCorrect: 9,
        durationMinutes: 10,
      });
      await logSession(ctx, accessToken, topicA.id, addDays(today(), -1), { durationMinutes: 5 });

      const res = await ctx.app.request('/analytics/dashboard', { headers: authed(accessToken) });
      expect(res.status).toBe(200);
      const data = await readJson<DashboardResponse>(res);

      expect(data.today.topicsReviewed).toBe(2);
      expect(data.today.questionsAttempted).toBe(20);
      expect(data.today.accuracy).toBeCloseTo(0.8);
      expect(data.today.minutesStudied).toBe(25);
      expect(data.streak.currentStreak).toBe(2);
      expect(data.streak.longestStreak).toBe(2);
      expect(data.activityCalendar).toHaveLength(365);
      expect(data.activityCalendar.at(-1)?.sessionCount).toBe(2);
    });

    it('reports null accuracy and a zero streak with no sessions at all', async () => {
      const { accessToken } = await createLoggedInUser(ctx);
      const res = await ctx.app.request('/analytics/dashboard', { headers: authed(accessToken) });
      const data = await readJson<DashboardResponse>(res);
      expect(data.today.accuracy).toBeNull();
      expect(data.streak).toEqual({ currentStreak: 0, longestStreak: 0 });
    });
  });

  describe('GET /analytics/mastery (FR-7.4)', () => {
    it('requires subjectId', async () => {
      const { accessToken } = await createLoggedInUser(ctx);
      expect((await ctx.app.request('/analytics/mastery', { headers: authed(accessToken) })).status).toBe(400);
    });

    it("returns each topic's own score, null for an unstudied topic", async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const studied = await ctx.fixtures.createTopic(userId, subject.id);
      const unstudied = await ctx.fixtures.createTopic(userId, subject.id);
      await logSession(ctx, accessToken, studied.id, today());

      const res = await ctx.app.request(`/analytics/mastery?subjectId=${subject.id}`, {
        headers: authed(accessToken),
      });
      expect(res.status).toBe(200);
      const { topics } = await readJson<MasteryResponse>(res);
      const byId = new Map(topics.map((t) => [t.topicId, t]));
      expect(byId.get(studied.id)?.score).not.toBeNull();
      expect(byId.get(studied.id)?.isProvisional).toBe(true);
      expect(byId.get(unstudied.id)?.score).toBeNull();
    });

    it("404s for another user's subject", async () => {
      const owner = await createLoggedInUser(ctx);
      const intruder = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(owner.userId);
      const res = await ctx.app.request(`/analytics/mastery?subjectId=${subject.id}`, {
        headers: authed(intruder.accessToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /analytics/heatmap (FR-7.5)', () => {
    it('distinguishes never-started, neglected and scored topics', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      await ctx.db.userSettings.update(userId, { neglectThresholdDays: 5 });
      const subject = await ctx.fixtures.createSubject(userId);
      const neverStarted = await ctx.fixtures.createTopic(userId, subject.id);
      const neglected = await ctx.fixtures.createTopic(userId, subject.id);
      const scored = await ctx.fixtures.createTopic(userId, subject.id);

      await logSession(ctx, accessToken, neglected.id, addDays(today(), -30));
      await logSession(ctx, accessToken, scored.id, today());

      const res = await ctx.app.request(`/analytics/heatmap?subjectId=${subject.id}`, {
        headers: authed(accessToken),
      });
      const { topics } = await readJson<HeatmapResponse>(res);
      const byId = new Map(topics.map((t) => [t.topicId, t]));
      expect(byId.get(neverStarted.id)?.status).toBe('neverStarted');
      expect(byId.get(neglected.id)?.status).toBe('neglected');
      expect(byId.get(scored.id)?.status).toBe('scored');
    });
  });

  describe('GET /analytics/health (FR-7.6)', () => {
    it('lists every topic across subjects, with accuracy/confidence % and a review trend', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);
      const other = await ctx.fixtures.createSubject(userId);
      const untouchedTopic = await ctx.fixtures.createTopic(userId, other.id);

      await logSession(ctx, accessToken, topic.id, addDays(today(), -2), {
        questionsAttempted: 10,
        questionsCorrect: 5,
        confidence: 3,
      });
      await logSession(ctx, accessToken, topic.id, today(), {
        questionsAttempted: 10,
        questionsCorrect: 10,
        confidence: 5,
      });

      const res = await ctx.app.request('/analytics/health', { headers: authed(accessToken) });
      expect(res.status).toBe(200);
      const { topics } = await readJson<TopicHealthResponse>(res);
      const byId = new Map(topics.map((t) => [t.topicId, t]));

      expect(byId.get(untouchedTopic.id)?.healthStatus).toBe('notStarted');
      expect(byId.get(untouchedTopic.id)?.score).toBeNull();

      // accuracy: (5+10)/(10+10) = 75%; confidence: mean(3,5)=4 -> (4-1)/4 = 75%.
      const studiedRow = byId.get(topic.id);
      expect(studiedRow?.accuracyPct).toBeCloseTo(75);
      expect(studiedRow?.confidencePct).toBeCloseTo(75);
      expect(studiedRow?.reviewTrend).toBe('up');
    });

    it('scopes to one subject when subjectId is given', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const other = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);
      await ctx.fixtures.createTopic(userId, other.id);

      const res = await ctx.app.request(`/analytics/health?subjectId=${subject.id}`, {
        headers: authed(accessToken),
      });
      const { topics } = await readJson<TopicHealthResponse>(res);
      expect(topics.map((t) => t.topicId)).toEqual([topic.id]);
    });
  });

  describe('GET /analytics/retention (FR-7.7)', () => {
    it('requires exactly one of topicId or subjectId', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);
      expect((await ctx.app.request('/analytics/retention', { headers: authed(accessToken) })).status).toBe(400);
      expect(
        (
          await ctx.app.request(`/analytics/retention?topicId=${topic.id}&subjectId=${subject.id}`, {
            headers: authed(accessToken),
          })
        ).status,
      ).toBe(400);
    });

    it('marks review events from snapshots and projects decay between them', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      // `capturedOn` is set to "now" at write time (see recalculateTopicSchedule), not the
      // session's `studiedOn` — creating snapshots directly is the only way to get two of them
      // at distinct, known `capturedOn` dates from a single (real-clock) test run.
      await ctx.db.competencySnapshots.create(userId, topic.id, {
        capturedOn: addDays(today(), -10),
        score: 91.5, // 100 * (0.6*0.9 + 0.25*0.9 + 0.15*1), matching the components below
        accuracyComponent: 0.9,
        confidenceComponent: 0.9,
        recencyComponent: 1,
      });
      await ctx.db.competencySnapshots.create(userId, topic.id, {
        capturedOn: today(),
        score: 83, // 100 * (0.6*0.8 + 0.25*0.8 + 0.15*1)
        accuracyComponent: 0.8,
        confidenceComponent: 0.8,
        recencyComponent: 1,
      });

      const res = await ctx.app.request(`/analytics/retention?topicId=${topic.id}`, {
        headers: authed(accessToken),
      });
      expect(res.status).toBe(200);
      const data = await readJson<RetentionResponse>(res);
      expect(data.events.length).toBe(2);
      expect(data.projection.length).toBeGreaterThan(0);
      // The projection should decay (not increase) between the two review events.
      const firstEventScore = data.events[0]?.score ?? 0;
      const midProjection = data.projection.find(
        (p) => p.date > (data.events[0]?.date ?? '') && p.date < (data.events[1]?.date ?? ''),
      );
      expect(midProjection).toBeDefined();
      expect(midProjection?.score ?? firstEventScore).toBeLessThanOrEqual(firstEventScore + 0.01);
    });

    it("404s for another user's topic", async () => {
      const owner = await createLoggedInUser(ctx);
      const intruder = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(owner.userId);
      const topic = await ctx.fixtures.createTopic(owner.userId, subject.id);
      const res = await ctx.app.request(`/analytics/retention?topicId=${topic.id}`, {
        headers: authed(intruder.accessToken),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /analytics/accuracy-confidence (FR-7.8)', () => {
    it('returns one point per session, oldest first, with confidence normalised to 0..1', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      await logSession(ctx, accessToken, topic.id, addDays(today(), -3), { confidence: 5 });
      await logSession(ctx, accessToken, topic.id, today(), { confidence: 1 });

      const res = await ctx.app.request(`/analytics/accuracy-confidence?topicId=${topic.id}`, {
        headers: authed(accessToken),
      });
      expect(res.status).toBe(200);
      const { points } = await readJson<AccuracyConfidenceResponse>(res);
      expect(points).toHaveLength(2);
      expect(points[0]?.confidence).toBe(5);
      expect(points[0]?.confidenceNormalised).toBeCloseTo(1);
      expect(points[1]?.confidenceNormalised).toBeCloseTo(0);
    });
  });
});

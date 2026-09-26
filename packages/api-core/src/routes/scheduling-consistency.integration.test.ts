import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createTokenService } from '../auth/tokens.js';

// R2 (documents/planning/review-remediation-plan.md): stored schedules and snapshot history must
// always equal what a fresh replay of the topic's sessions would produce — whatever order the
// sessions were logged, edited or deleted in, and whenever the algorithm or ladder feeding that
// replay changes.

interface SnapshotView {
  capturedOn: string;
  score: number;
  triggeredBySessionId: string | null;
}

interface ScheduleView {
  algorithm: string;
  nextReviewOn: string | null;
  intervalDays: number | null;
  lastReviewedOn: string | null;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createLoggedInUser(ctx: ApiTestContext): Promise<{ accessToken: string; userId: string }> {
  const user = await ctx.fixtures.createUser({ role: 'LEARNER' });
  await ctx.db.userSettings.createDefault(user.id);
  const accessToken = await createTokenService('a'.repeat(32)).signAccessToken({ userId: user.id, role: 'LEARNER' });
  return { accessToken, userId: user.id };
}

function authed(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}

/** `YYYY-MM-DD`, `daysAgo` days before today (UTC-based, matching §6.3). */
function iso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe('schedule & snapshot consistency (R2)', () => {
  let ctx: ApiTestContext;
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    ctx = await setupApiTest();
    ({ accessToken, userId } = await createLoggedInUser(ctx));
  });

  afterEach(() => ctx.teardown());

  async function logSession(
    topicId: string,
    body: { studiedOn: string; questionsAttempted: number; questionsCorrect: number; confidence: number },
  ): Promise<string> {
    const res = await ctx.app.request(`/topics/${topicId}/sessions`, {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    return (await readJson<{ session: { id: string } }>(res)).session.id;
  }

  async function history(topicId: string): Promise<SnapshotView[]> {
    const res = await ctx.app.request(`/topics/${topicId}/history`, { headers: authed(accessToken) });
    return (await readJson<{ snapshots: SnapshotView[] }>(res)).snapshots;
  }

  async function schedule(topicId: string): Promise<ScheduleView | null> {
    const res = await ctx.app.request(`/topics/${topicId}/schedule`, { headers: authed(accessToken) });
    return (await readJson<{ schedule: ScheduleView | null }>(res)).schedule;
  }

  describe('snapshot history is derived from sessions (D-3)', () => {
    it('puts a back-dated session on the day it was studied, not the day it was logged', async () => {
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      await logSession(topic.id, { studiedOn: iso(20), questionsAttempted: 10, questionsCorrect: 6, confidence: 3 });

      const snapshots = await history(topic.id);
      expect(snapshots.map((s) => s.capturedOn.slice(0, 10))).toEqual([iso(20)]);
    });

    it('back-dating, editing and deleting sessions leaves exactly the history a clean replay produces', async () => {
      const subject = await ctx.fixtures.createSubject(userId);
      const messy = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Messy' });
      const clean = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Clean' });

      // Messy: logged out of order, one edit, one extra session later deleted.
      await logSession(messy.id, { studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 });
      const backdated = await logSession(messy.id, {
        studiedOn: iso(30),
        questionsAttempted: 10,
        questionsCorrect: 2,
        confidence: 1,
      });
      const extra = await logSession(messy.id, { studiedOn: iso(10), questionsAttempted: 5, questionsCorrect: 0, confidence: 1 });
      await logSession(messy.id, { studiedOn: iso(20), questionsAttempted: 10, questionsCorrect: 7, confidence: 3 });
      const edit = await ctx.app.request(`/sessions/${backdated}`, {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ questionsCorrect: 5, confidence: 2 }),
      });
      expect(edit.status).toBe(200);
      const del = await ctx.app.request(`/sessions/${extra}`, { method: 'DELETE', headers: authed(accessToken) });
      expect(del.status).toBe(200);

      // Clean: the same final sessions, logged once each in chronological order.
      await logSession(clean.id, { studiedOn: iso(30), questionsAttempted: 10, questionsCorrect: 5, confidence: 2 });
      await logSession(clean.id, { studiedOn: iso(20), questionsAttempted: 10, questionsCorrect: 7, confidence: 3 });
      await logSession(clean.id, { studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 });

      const messyHistory = await history(messy.id);
      const cleanHistory = await history(clean.id);
      // One snapshot per study day — no duplicates from the edit/delete writes.
      expect(messyHistory.map((s) => s.capturedOn.slice(0, 10))).toEqual([iso(30), iso(20), iso(10)]);
      expect(messyHistory.map((s) => s.score)).toEqual(cleanHistory.map((s) => s.score));

      const messySchedule = await schedule(messy.id);
      const cleanSchedule = await schedule(clean.id);
      expect(messySchedule?.nextReviewOn).toBe(cleanSchedule?.nextReviewOn);
    });

    it('drops a day\'s snapshot when that day\'s only session is deleted', async () => {
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);
      await logSession(topic.id, { studiedOn: iso(20), questionsAttempted: 10, questionsCorrect: 6, confidence: 3 });
      const later = await logSession(topic.id, { studiedOn: iso(5), questionsAttempted: 10, questionsCorrect: 8, confidence: 4 });

      await ctx.app.request(`/sessions/${later}`, { method: 'DELETE', headers: authed(accessToken) });

      expect((await history(topic.id)).map((s) => s.capturedOn.slice(0, 10))).toEqual([iso(20)]);
    });
  });

  describe('schedules follow the effective algorithm and ladder (D-2)', () => {
    it("re-derives schedules when a subject's default algorithm changes, except topics with their own override", async () => {
      const subject = await ctx.fixtures.createSubject(userId);
      const inherits = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Inherits' });
      const overridden = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Overridden' });
      await ctx.db.topics.update(userId, overridden.id, { algorithmOverride: 'manual' });
      for (const topicId of [inherits.id, overridden.id]) {
        await logSession(topicId, { studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 });
      }

      const res = await ctx.app.request(`/subjects/${subject.id}`, {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ defaultAlgorithm: 'sm2' }),
      });
      expect(res.status).toBe(200);
      expect((await readJson<{ schedulesChanged: number }>(res)).schedulesChanged).toBe(1);

      expect((await schedule(inherits.id))?.algorithm).toBe('sm2');
      expect((await schedule(overridden.id))?.algorithm).toBe('manual');
    });

    it("re-derives schedules when the user's default algorithm changes, only for topics that inherit it", async () => {
      const plain = await ctx.fixtures.createSubject(userId, { name: 'Plain' });
      const withDefault = await ctx.fixtures.createSubject(userId, { name: 'With default' });
      await ctx.db.subjects.update(userId, withDefault.id, { defaultAlgorithm: 'sm2' });
      const inherits = await ctx.fixtures.createTopic(userId, plain.id);
      const subjectDecides = await ctx.fixtures.createTopic(userId, withDefault.id);
      for (const topicId of [inherits.id, subjectDecides.id]) {
        await logSession(topicId, { studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 });
      }

      const res = await ctx.app.request('/me/settings', {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ defaultAlgorithm: 'manual' }),
      });
      expect(res.status).toBe(200);
      expect((await readJson<{ schedulesChanged: number }>(res)).schedulesChanged).toBe(1);

      expect((await schedule(inherits.id))?.algorithm).toBe('manual');
      expect((await schedule(subjectDecides.id))?.algorithm).toBe('sm2');
    });

    it('re-derives manual-algorithm schedules when the manual ladder changes', async () => {
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);
      await ctx.db.topics.update(userId, topic.id, { algorithmOverride: 'manual' });
      await logSession(topic.id, { studiedOn: iso(2), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 });
      const before = await schedule(topic.id);

      const res = await ctx.app.request('/me/settings', {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ manualIntervals: [5, 10, 20] }),
      });
      expect((await readJson<{ schedulesChanged: number }>(res)).schedulesChanged).toBe(1);

      const after = await schedule(topic.id);
      expect(after?.intervalDays).not.toBe(before?.intervalDays);
      expect(after?.intervalDays).toBe(5);
    });

    it('re-derives schedules when a topic moves to a subject with a different default', async () => {
      const from = await ctx.fixtures.createSubject(userId, { name: 'From' });
      const to = await ctx.fixtures.createSubject(userId, { name: 'To' });
      await ctx.db.subjects.update(userId, to.id, { defaultAlgorithm: 'sm2' });
      const topic = await ctx.fixtures.createTopic(userId, from.id);
      await logSession(topic.id, { studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 });

      const res = await ctx.app.request(`/topics/${topic.id}/move`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ parentId: null, subjectId: to.id }),
      });
      expect(res.status).toBe(200);
      expect((await schedule(topic.id))?.algorithm).toBe('sm2');
    });

    it('keeps a next-review date set directly on a never-studied topic when the algorithm changes', async () => {
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);
      await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'setNextReviewOn', nextReviewOn: iso(-3) }),
      });

      await ctx.app.request(`/topics/${topic.id}`, {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ algorithmOverride: 'sm2' }),
      });

      const after = await schedule(topic.id);
      expect(after?.nextReviewOn?.slice(0, 10)).toBe(iso(-3));
      expect(after?.algorithm).toBe('sm2');
    });
  });

  it('reset-scoring resets weights and thresholds but leaves the manual ladder alone (D-7)', async () => {
    await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ manualIntervals: [2, 4, 8], weightAccuracy: 0.5, weightConfidence: 0.3, weightRecency: 0.2 }),
    });

    const res = await ctx.app.request('/me/settings/reset-scoring', { method: 'POST', headers: authed(accessToken) });
    const { settings } = await readJson<{ settings: { manualIntervals: number[]; weightAccuracy: number } }>(res);
    expect(settings.weightAccuracy).toBe(0.6);
    expect(settings.manualIntervals).toEqual([2, 4, 8]);
  });
});

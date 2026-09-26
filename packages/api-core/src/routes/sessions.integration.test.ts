import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeCompetencyScore, getScheduler, replaySchedule, roundScoreForStorage, type Grade } from '@topicmatrix/core';
import { addDays, scheduleOverrideResponseSchema, startOfUserDay } from '@topicmatrix/shared';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

interface SessionView {
  id: string;
  topicId: string;
  studiedOn: string;
  questionsAttempted: number;
  questionsCorrect: number;
  accuracy: number;
  confidence: number;
  gradeUsed: number | null;
}

interface ScheduleView {
  topicId: string;
  algorithm: string;
  nextReviewOn: string | null;
  intervalDays: number | null;
  repetitions: number;
  isSuspended: boolean;
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

/** `YYYY-MM-DD`, `daysAgo` days before today (negative = in the future). UTC-based, matching §6.3. */
function iso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const MANUAL_INTERVALS = [1, 3, 7, 14, 30, 60];

/** Narrows a nullable value with a real runtime check, avoiding a banned `!` assertion in tests. */
function mustExist<T>(value: T | null | undefined, message = 'Expected value to exist'): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

describe('study session, scoring and scheduling routes (FR-4.*, FR-5.*, delivery-plan.md P5)', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects an unauthenticated request with 401', async () => {
    expect((await ctx.app.request('/topics/anything/sessions')).status).toBe(401);
  });

  it('creates a session (recalculating the schedule), lists, updates and deletes it', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);

    const create = await ctx.app.request(`/topics/${topic.id}/sessions`, {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({
        studiedOn: iso(10),
        questionsAttempted: 10,
        questionsCorrect: 9,
        confidence: 4,
      }),
    });
    expect(create.status).toBe(201);
    const created = await readJson<{ session: SessionView; schedule: ScheduleView }>(create);
    expect(created.session.accuracy).toBeCloseTo(0.9);
    expect(created.schedule.nextReviewOn).not.toBeNull();
    expect(created.schedule.algorithm).toBe('fsrs');

    const list = await ctx.app.request(`/topics/${topic.id}/sessions`, { headers: authed(accessToken) });
    expect((await readJson<{ sessions: SessionView[] }>(list)).sessions).toHaveLength(1);

    const patch = await ctx.app.request(`/sessions/${created.session.id}`, {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ confidence: 2 }),
    });
    expect(patch.status).toBe(200);
    const patched = await readJson<{ session: SessionView; schedule: ScheduleView }>(patch);
    expect(patched.session.confidence).toBe(2);

    const del = await ctx.app.request(`/sessions/${created.session.id}`, {
      method: 'DELETE',
      headers: authed(accessToken),
    });
    expect(del.status).toBe(200);
    const afterDelete = await readJson<{ schedule: ScheduleView | null }>(del);
    // No sessions left -> no schedule (never stale scheduling state, see recalculateTopicSchedule).
    expect(afterDelete.schedule).toBeNull();
    expect(await ctx.db.reviewSchedules.find(userId, topic.id)).toBeNull();
  });

  it('rejects questionsCorrect greater than questionsAttempted with 422', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);

    const res = await ctx.app.request(`/topics/${topic.id}/sessions`, {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ studiedOn: iso(1), questionsAttempted: 5, questionsCorrect: 6, confidence: 3 }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects a studiedOn date in the future with 422 (FR-4.1)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);

    const res = await ctx.app.request(`/topics/${topic.id}/sessions`, {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ studiedOn: iso(-5), questionsAttempted: 5, questionsCorrect: 5, confidence: 3 }),
    });
    expect(res.status).toBe(422);
  });

  it('previews the grade a session would produce without persisting anything (FR-5.4)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);

    const res = await ctx.app.request(`/topics/${topic.id}/sessions/preview`, {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({ questionsAttempted: 10, questionsCorrect: 10, confidence: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ accuracy: number; grade: number }>(res);
    expect(body.accuracy).toBe(1);
    expect(body.grade).toBe(4);
    expect(await ctx.db.studySessions.listByTopic(userId, topic.id)).toHaveLength(0);
  });

  it("returns 404 (not 403) for another user's topic/session on every route", async () => {
    const owner = await createLoggedInUser(ctx);
    const intruder = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(owner.userId);
    const topic = await ctx.fixtures.createTopic(owner.userId, subject.id);
    const session = await ctx.fixtures.createStudySession(owner.userId, topic.id, {
      studiedOn: new Date(`${iso(5)}T00:00:00.000Z`),
    });

    const attackerAuth = authed(intruder.accessToken);
    expect((await ctx.app.request(`/topics/${topic.id}/sessions`, { headers: attackerAuth })).status).toBe(404);
    expect(
      (
        await ctx.app.request(`/topics/${topic.id}/sessions`, {
          method: 'POST',
          headers: attackerAuth,
          body: JSON.stringify({ questionsAttempted: 1, questionsCorrect: 1, confidence: 3 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await ctx.app.request(`/topics/${topic.id}/sessions/preview`, {
          method: 'POST',
          headers: attackerAuth,
          body: JSON.stringify({ questionsAttempted: 1, questionsCorrect: 1, confidence: 3 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await ctx.app.request(`/sessions/${session.id}`, {
          method: 'PATCH',
          headers: attackerAuth,
          body: JSON.stringify({ confidence: 1 }),
        })
      ).status,
    ).toBe(404);
    expect((await ctx.app.request(`/sessions/${session.id}`, { method: 'DELETE', headers: attackerAuth })).status).toBe(
      404,
    );
    expect((await ctx.app.request(`/topics/${topic.id}/history`, { headers: attackerAuth })).status).toBe(404);
    expect(
      (
        await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
          method: 'POST',
          headers: attackerAuth,
          body: JSON.stringify({ action: 'suspend', suspended: true }),
        })
      ).status,
    ).toBe(404);

    expect(await ctx.db.studySessions.findById(owner.userId, session.id)).not.toBeNull();
  });

  describe('POST /topics/:id/schedule/override (FR-5.6, FR-5.10)', () => {
    it('sets an explicit next-review date, snoozes by n days, and suspends/unsuspends', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      const explicitDate = iso(-5); // 5 days in the future
      const setDate = await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'setNextReviewOn', nextReviewOn: explicitDate }),
      });
      expect(setDate.status).toBe(200);
      const afterSet = (await readJson<{ schedule: ScheduleView }>(setDate)).schedule;
      expect(afterSet.nextReviewOn?.slice(0, 10)).toBe(explicitDate);
      expect(afterSet.isSuspended).toBe(false);

      const snooze = await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'snooze', days: 3 }),
      });
      const afterSnooze = (await readJson<{ schedule: ScheduleView }>(snooze)).schedule;
      const expectedSnoozed = new Date(mustExist(afterSet.nextReviewOn));
      expectedSnoozed.setUTCDate(expectedSnoozed.getUTCDate() + 3);
      expect(afterSnooze.nextReviewOn).toBe(expectedSnoozed.toISOString());

      const suspend = await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'suspend', suspended: true }),
      });
      const afterSuspend = (await readJson<{ schedule: ScheduleView }>(suspend)).schedule;
      expect(afterSuspend.isSuspended).toBe(true);
      // Suspending must not disturb the previously-set date (FR-5.10 is independent of FR-5.6).
      expect(afterSuspend.nextReviewOn).toBe(afterSnooze.nextReviewOn);
    });

    it('snoozes an overdue topic from today, not from its past due date', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'setNextReviewOn', nextReviewOn: iso(10) }), // 10 days overdue
      });
      const snooze = await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'snooze', days: 1 }),
      });
      expect(snooze.status).toBe(200);
      const afterSnooze = (await readJson<{ schedule: ScheduleView }>(snooze)).schedule;

      // Default settings: Europe/London, day starting at 04:00.
      const userToday = startOfUserDay(new Date(), 'Europe/London', 4);
      expect(afterSnooze.nextReviewOn).toBe(addDays(userToday, 1).toISOString());
    });

    it('can suspend a topic that has never been studied, on the topic itself (one suspend flag)', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      expect(await ctx.db.reviewSchedules.find(userId, topic.id)).toBeNull();
      const res = await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'suspend', suspended: true }),
      });
      expect(res.status).toBe(200);
      // The response matches the shared schema the web client parses it with (it didn't, before
      // R2: `status` was missing, so every Pause/Snooze in the UI reported a failure).
      const body = scheduleOverrideResponseSchema.parse(await res.json());
      expect(body.schedule).toBeNull(); // no schedule row is invented just to hold the flag
      expect((await ctx.db.topics.findById(userId, topic.id))?.isSuspended).toBe(true);
    });

    it('keeps a suspended topic suspended through later session writes, and out of the queue', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      await ctx.app.request(`/topics/${topic.id}/schedule/override`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ action: 'suspend', suspended: true }),
      });
      const logged = await ctx.app.request(`/topics/${topic.id}/sessions`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ studiedOn: iso(30), questionsAttempted: 10, questionsCorrect: 5, confidence: 2 }),
      });
      const schedule = (await readJson<{ schedule: ScheduleView }>(logged)).schedule;
      expect(schedule.isSuspended).toBe(true);

      const queue = await readJson<{ overdue: { topicId: string }[] }>(
        await ctx.app.request('/review/queue', { headers: authed(accessToken) }),
      );
      expect(queue.overdue.map((i) => i.topicId)).not.toContain(topic.id);

      // …and it's not counted as due on the subject card either.
      const subjects = await readJson<{ subjects: { id: string; summary: { dueTodayCount: number } }[] }>(
        await ctx.app.request('/subjects', { headers: authed(accessToken) }),
      );
      expect(subjects.subjects.find((s) => s.id === subject.id)?.summary.dueTodayCount).toBe(0);
    });
  });

  it('GET /topics/:id/history returns a date-range-filterable snapshot per study day (FR-7.7/7.10)', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);

    for (let i = 0; i < 3; i += 1) {
      await ctx.app.request(`/topics/${topic.id}/sessions`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({
          studiedOn: iso(20 - i * 5),
          questionsAttempted: 10,
          questionsCorrect: 8,
          confidence: 3,
        }),
      });
    }

    const all = await ctx.app.request(`/topics/${topic.id}/history`, { headers: authed(accessToken) });
    expect((await readJson<{ snapshots: unknown[] }>(all)).snapshots).toHaveLength(3);

    const future = await ctx.app.request(`/topics/${topic.id}/history?from=${iso(-1000)}`, {
      headers: authed(accessToken),
    });
    expect((await readJson<{ snapshots: unknown[] }>(future)).snapshots).toHaveLength(0);

    const badRange = await ctx.app.request(`/topics/${topic.id}/history?from=not-a-date`, {
      headers: authed(accessToken),
    });
    expect(badRange.status).toBe(400);
  });

  describe('recalculation on write (§8.6, FR-4.3/4.4/4.7/5.7)', () => {
    it('produces the same schedule whether a back-dated session is logged out of order or in chronological order', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const inOrder = await ctx.fixtures.createTopic(userId, subject.id, { name: 'In order' });
      const outOfOrder = await ctx.fixtures.createTopic(userId, subject.id, { name: 'Backdated' });

      const sessions = [
        { studiedOn: iso(30), questionsAttempted: 10, questionsCorrect: 6, confidence: 2 },
        { studiedOn: iso(20), questionsAttempted: 10, questionsCorrect: 8, confidence: 3 },
        { studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 },
      ];

      for (const data of sessions) {
        await ctx.app.request(`/topics/${inOrder.id}/sessions`, {
          method: 'POST',
          headers: authed(accessToken),
          body: JSON.stringify(data),
        });
      }
      // Same three sessions, but the middle one (day -20) is logged last — a back-dated insert.
      for (const data of [sessions[0], sessions[2], sessions[1]]) {
        await ctx.app.request(`/topics/${outOfOrder.id}/sessions`, {
          method: 'POST',
          headers: authed(accessToken),
          body: JSON.stringify(data),
        });
      }

      const scheduleInOrder = await ctx.db.reviewSchedules.find(userId, inOrder.id);
      const scheduleBackdated = await ctx.db.reviewSchedules.find(userId, outOfOrder.id);
      expect(scheduleBackdated?.nextReviewOn?.getTime()).toBe(scheduleInOrder?.nextReviewOn?.getTime());
      expect(scheduleBackdated?.intervalDays).toBe(scheduleInOrder?.intervalDays);
      expect(scheduleBackdated?.repetitions).toBe(scheduleInOrder?.repetitions);
      expect(scheduleBackdated?.stability).toBeCloseTo(scheduleInOrder?.stability ?? 0, 6);
    });

    it('after deleting a session, the schedule and latest snapshot match a fresh replay of the remaining sessions', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      const sessionIds: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await ctx.app.request(`/topics/${topic.id}/sessions`, {
          method: 'POST',
          headers: authed(accessToken),
          body: JSON.stringify({
            studiedOn: iso(40 - i * 8),
            questionsAttempted: 10,
            questionsCorrect: 7 + (i % 3),
            confidence: 3,
          }),
        });
        sessionIds.push((await readJson<{ session: SessionView }>(res)).session.id);
      }

      const del = await ctx.app.request(`/sessions/${sessionIds[1]}`, {
        method: 'DELETE',
        headers: authed(accessToken),
      });
      expect(del.status).toBe(200);

      const remaining = await ctx.db.studySessions.listByTopic(userId, topic.id);
      expect(remaining).toHaveLength(4);

      const schedule = await ctx.db.reviewSchedules.find(userId, topic.id);
      expect(schedule).not.toBeNull();

      const expectedReplay = replaySchedule(
        remaining.map((s) => ({
          studiedOn: s.studiedOn,
          accuracy: s.accuracy,
          confidence: s.confidence,
          gradeUsed: s.gradeUsed as Grade | null,
        })),
        getScheduler('fsrs'),
        { manualIntervals: MANUAL_INTERVALS },
      );
      expect(expectedReplay).not.toBeNull();
      expect(schedule?.nextReviewOn?.getTime()).toBe(expectedReplay?.nextReviewOn.getTime());
      expect(schedule?.intervalDays).toBe(expectedReplay?.intervalDays);
      expect(schedule?.repetitions).toBe(expectedReplay?.state.repetitions);

      const snapshots = await ctx.db.competencySnapshots.listByTopic(userId, topic.id);
      const latestSnapshot = mustExist(snapshots[snapshots.length - 1], 'Expected a snapshot to have been recorded');

      const expectedScore = computeCompetencyScore({
        sessions: remaining.map((s) => ({
          studiedOn: s.studiedOn,
          questionsAttempted: s.questionsAttempted,
          accuracy: s.accuracy,
          confidence: s.confidence,
        })),
        asOfDate: latestSnapshot.capturedOn,
        currentIntervalDays: expectedReplay?.intervalDays ?? null,
      });
      expect(latestSnapshot.score).toBeCloseTo(roundScoreForStorage(mustExist(expectedScore.score)), 1);
    });

    it('two topics with identical sessions but different algorithms produce different, correct next-review dates (FR-5.3/5.8)', async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const fsrsTopic = await ctx.fixtures.createTopic(userId, subject.id, {
        name: 'FSRS topic',
        algorithmOverride: 'fsrs',
      });
      const sm2Topic = await ctx.fixtures.createTopic(userId, subject.id, {
        name: 'SM2 topic',
        algorithmOverride: 'sm2',
      });

      const sessions = [
        { studiedOn: iso(20), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 },
        { studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 },
      ];
      for (const topic of [fsrsTopic, sm2Topic]) {
        for (const data of sessions) {
          await ctx.app.request(`/topics/${topic.id}/sessions`, {
            method: 'POST',
            headers: authed(accessToken),
            body: JSON.stringify(data),
          });
        }
      }

      const scheduleFsrs = await ctx.db.reviewSchedules.find(userId, fsrsTopic.id);
      const scheduleSm2 = await ctx.db.reviewSchedules.find(userId, sm2Topic.id);
      expect(scheduleFsrs?.algorithm).toBe('fsrs');
      expect(scheduleSm2?.algorithm).toBe('sm2');
      expect(scheduleFsrs?.nextReviewOn?.getTime()).not.toBe(scheduleSm2?.nextReviewOn?.getTime());

      const replayInputs = sessions.map((s) => ({
        studiedOn: new Date(`${s.studiedOn}T00:00:00.000Z`),
        accuracy: s.questionsCorrect / s.questionsAttempted,
        confidence: s.confidence,
        gradeUsed: null,
      }));
      const expectedFsrs = replaySchedule(replayInputs, getScheduler('fsrs'), { manualIntervals: MANUAL_INTERVALS });
      const expectedSm2 = replaySchedule(replayInputs, getScheduler('sm2'), { manualIntervals: MANUAL_INTERVALS });
      expect(scheduleFsrs?.nextReviewOn?.getTime()).toBe(expectedFsrs?.nextReviewOn.getTime());
      expect(scheduleSm2?.nextReviewOn?.getTime()).toBe(expectedSm2?.nextReviewOn.getTime());
    });

    it("changing a topic's algorithm re-derives the schedule from history and reports whether dates changed (FR-5.7)", async () => {
      const { accessToken, userId } = await createLoggedInUser(ctx);
      const subject = await ctx.fixtures.createSubject(userId);
      const topic = await ctx.fixtures.createTopic(userId, subject.id);

      await ctx.app.request(`/topics/${topic.id}/sessions`, {
        method: 'POST',
        headers: authed(accessToken),
        body: JSON.stringify({ studiedOn: iso(10), questionsAttempted: 10, questionsCorrect: 9, confidence: 4 }),
      });

      const patch = await ctx.app.request(`/topics/${topic.id}`, {
        method: 'PATCH',
        headers: authed(accessToken),
        body: JSON.stringify({ algorithmOverride: 'sm2' }),
      });
      expect(patch.status).toBe(200);
      const body = await readJson<{ scheduleChanged: boolean }>(patch);
      expect(body.scheduleChanged).toBe(true);

      const schedule = await ctx.db.reviewSchedules.find(userId, topic.id);
      expect(schedule?.algorithm).toBe('sm2');
    });
  });
});

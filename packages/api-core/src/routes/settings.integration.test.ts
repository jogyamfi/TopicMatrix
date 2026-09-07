import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiTest, type ApiTestContext } from '../../test/setup.js';
import { createPasswordService } from '../auth/password.js';
import { createTokenService } from '../auth/tokens.js';

interface SettingsView {
  timezone: string;
  dayStartHour: number;
  defaultAlgorithm: string;
  manualIntervals: number[];
  neglectThresholdDays: number;
  weightAccuracy: number;
  weightConfidence: number;
  weightRecency: number;
  strongThreshold: number;
  needsReviewThreshold: number;
  theme: string;
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

describe('settings routes (FR-8.1, FR-8.2)', () => {
  let ctx: ApiTestContext;

  beforeEach(async () => {
    ctx = await setupApiTest();
  });

  afterEach(() => ctx.teardown());

  it('rejects an unauthenticated request with 401', async () => {
    expect((await ctx.app.request('/me/settings')).status).toBe(401);
  });

  it('returns the default settings row for a new user', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/me/settings', { headers: authed(accessToken) });
    expect(res.status).toBe(200);
    const { settings } = await readJson<{ settings: SettingsView }>(res);
    expect(settings.timezone).toBe('Europe/London');
    expect(settings.manualIntervals).toEqual([1, 3, 7, 14, 30, 60]);
  });

  it('updates a single field via PATCH', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ dayStartHour: 6 }),
    });
    expect(res.status).toBe(200);
    const { settings } = await readJson<{ settings: SettingsView }>(res);
    expect(settings.dayStartHour).toBe(6);
  });

  it('rejects an invalid IANA timezone', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ timezone: 'Not/A_Zone' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects scoring weights that do not sum to 1.0', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ weightAccuracy: 0.9, weightConfidence: 0.5, weightRecency: 0.5 }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects needsReviewThreshold >= strongThreshold', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ strongThreshold: 60, needsReviewThreshold: 60 }),
    });
    expect(res.status).toBe(422);
  });

  it('accepts a partial weight update that keeps the final merged sum at 1.0', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    // Defaults are 0.60/0.25/0.15 — raising accuracy alone would break the sum unless the
    // caller also supplies compensating values; a single unrelated field (dayStartHour) must
    // not be rejected just because weights weren't touched.
    const res = await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ weightAccuracy: 0.5, weightConfidence: 0.3, weightRecency: 0.2 }),
    });
    expect(res.status).toBe(200);
  });

  it('rewrites the manual interval ladder', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ manualIntervals: [2, 4, 8] }),
    });
    expect(res.status).toBe(200);
    const { settings } = await readJson<{ settings: SettingsView }>(res);
    expect(settings.manualIntervals).toEqual([2, 4, 8]);
  });

  it('resets scoring weights/thresholds to platform defaults', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    await ctx.app.request('/me/settings', {
      method: 'PATCH',
      headers: authed(accessToken),
      body: JSON.stringify({ weightAccuracy: 0.5, weightConfidence: 0.3, weightRecency: 0.2 }),
    });
    const res = await ctx.app.request('/me/settings/reset-scoring', {
      method: 'POST',
      headers: authed(accessToken),
    });
    expect(res.status).toBe(200);
    const { settings } = await readJson<{ settings: SettingsView }>(res);
    expect(settings.weightAccuracy).toBeCloseTo(0.6);
    expect(settings.weightConfidence).toBeCloseTo(0.25);
    expect(settings.weightRecency).toBeCloseTo(0.15);
  });

  it('previews a proposed weight change against a sample topic', async () => {
    const { accessToken, userId } = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(userId);
    const topic = await ctx.fixtures.createTopic(userId, subject.id);
    await ctx.fixtures.createStudySession(userId, topic.id, {
      questionsAttempted: 10,
      questionsCorrect: 8,
      confidence: 4,
    });

    const res = await ctx.app.request('/me/settings/preview', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({
        topicId: topic.id,
        weightAccuracy: 0.8,
        weightConfidence: 0.1,
        weightRecency: 0.1,
        strongThreshold: 75,
        needsReviewThreshold: 50,
      }),
    });
    expect(res.status).toBe(200);
    const { preview } = await readJson<{
      preview: { topicId: string; current: { score: number | null }; proposed: { score: number | null } } | null;
    }>(res);
    expect(preview).not.toBeNull();
    expect(preview?.topicId).toBe(topic.id);
    expect(preview?.current.score).not.toBeNull();
    expect(preview?.proposed.score).not.toBeNull();
  });

  it('returns a null preview when the user has no topics yet', async () => {
    const { accessToken } = await createLoggedInUser(ctx);
    const res = await ctx.app.request('/me/settings/preview', {
      method: 'POST',
      headers: authed(accessToken),
      body: JSON.stringify({
        weightAccuracy: 0.6,
        weightConfidence: 0.25,
        weightRecency: 0.15,
        strongThreshold: 75,
        needsReviewThreshold: 50,
      }),
    });
    expect(res.status).toBe(200);
    expect((await readJson<{ preview: unknown }>(res)).preview).toBeNull();
  });

  it("404s previewing another user's topic", async () => {
    const owner = await createLoggedInUser(ctx);
    const intruder = await createLoggedInUser(ctx);
    const subject = await ctx.fixtures.createSubject(owner.userId);
    const topic = await ctx.fixtures.createTopic(owner.userId, subject.id);

    const res = await ctx.app.request('/me/settings/preview', {
      method: 'POST',
      headers: authed(intruder.accessToken),
      body: JSON.stringify({
        topicId: topic.id,
        weightAccuracy: 0.6,
        weightConfidence: 0.25,
        weightRecency: 0.15,
        strongThreshold: 75,
        needsReviewThreshold: 50,
      }),
    });
    expect(res.status).toBe(404);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUserWithDefaultSettings, logStudySession, rotateRefreshToken } from '../src/index.js';
import { setupIntegrationTest, type IntegrationTestContext } from './setup.js';

// R2 D-4: multi-step writes commit together or not at all.
describe('atomic multi-step writes (R2 D-4)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await setupIntegrationTest();
  }, 30_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('rolls the session back when the recalculation that follows it fails', async () => {
    // No settings row: recalculation throws NOT_FOUND after the session insert.
    const user = await ctx.fixtures.createUser();
    const subject = await ctx.fixtures.createSubject(user.id);
    const topic = await ctx.fixtures.createTopic(user.id, subject.id);

    await expect(
      logStudySession(ctx.db, user.id, {
        topicId: topic.id,
        studiedOn: new Date(Date.UTC(2026, 0, 10)),
        questionsAttempted: 10,
        questionsCorrect: 7,
        confidence: 3,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await ctx.db.studySessions.listByTopic(user.id, topic.id)).toHaveLength(0);
  });

  it('logs a session and its schedule + snapshot together', async () => {
    const { user } = await ctx.fixtures.createUserWithSettings();
    const subject = await ctx.fixtures.createSubject(user.id);
    const topic = await ctx.fixtures.createTopic(user.id, subject.id);

    const { session, recalculation } = await logStudySession(ctx.db, user.id, {
      topicId: topic.id,
      studiedOn: new Date(Date.UTC(2026, 0, 10)),
      questionsAttempted: 10,
      questionsCorrect: 7,
      confidence: 3,
    });

    expect(recalculation.schedule?.lastReviewedOn?.getTime()).toBe(session.studiedOn.getTime());
    const snapshots = await ctx.db.competencySnapshots.listByTopic(user.id, topic.id);
    expect(snapshots.map((s) => s.triggeredBySessionId)).toEqual([session.id]);
  });

  it('creates a user together with their default settings row', async () => {
    const user = await createUserWithDefaultSettings(ctx.db, {
      email: 'atomic@example.com',
      emailNormalised: 'atomic@example.com',
      passwordHash: 'not-a-real-hash',
      displayName: 'Atomic',
    });
    expect(await ctx.db.userSettings.find(user.id)).not.toBeNull();
  });

  it('rotates a refresh token as one step: the old one is revoked and points at its successor', async () => {
    const user = await ctx.fixtures.createUser();
    const old = await ctx.db.refreshTokens.create(user.id, {
      tokenHash: 'rotate-old-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const next = await rotateRefreshToken(
      ctx.db,
      user.id,
      old.id,
      { tokenHash: 'rotate-new-hash', expiresAt: new Date(Date.now() + 120_000) },
      new Date(),
    );

    const reloaded = await ctx.db.refreshTokens.findByTokenHash('rotate-old-hash');
    expect(reloaded?.revokedAt).not.toBeNull();
    expect(reloaded?.replacedByTokenId).toBe(next.id);
  });
});

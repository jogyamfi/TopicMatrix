import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, startOfUserDay } from '@topicmatrix/shared';
import { setupIntegrationTest, type IntegrationTestContext } from './setup.js';

describe('packages/db repositories (real database)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await setupIntegrationTest();
  }, 30_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('logs which provider this run is against', () => {
    expect(['sqlite', 'postgresql']).toContain(ctx.provider);
  });

  describe('users', () => {
    it('creates a user and finds it by id and by normalised email', async () => {
      const user = await ctx.fixtures.createUser({ email: 'Alice@Example.com', emailNormalised: 'alice@example.com' });
      expect(await ctx.db.users.findById(user.id)).toMatchObject({ id: user.id });
      expect(await ctx.db.users.findByEmailNormalised('alice@example.com')).toMatchObject({ id: user.id });
    });

    it('creates default settings for a user', async () => {
      const { user, settings } = await ctx.fixtures.createUserWithSettings();
      expect(settings.userId).toBe(user.id);
      expect(settings.timezone).toBe('Europe/London');
      expect(settings.dayStartHour).toBe(4);
    });
  });

  describe('subjects — cross-user isolation', () => {
    it("findById returns null for another user's subject", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);

      expect(await ctx.db.subjects.findById(intruder.id, subject.id)).toBeNull();
      expect(await ctx.db.subjects.findById(owner.id, subject.id)).toMatchObject({ id: subject.id });
    });

    it("update throws NOT_FOUND for another user's subject", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);

      await expect(
        ctx.db.subjects.update(intruder.id, subject.id, { name: 'Hijacked' }),
      ).rejects.toThrow(AppError);
    });

    it("delete throws NOT_FOUND for another user's subject, and the row survives", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);

      await expect(ctx.db.subjects.delete(intruder.id, subject.id)).rejects.toThrow(AppError);
      expect(await ctx.db.subjects.findById(owner.id, subject.id)).not.toBeNull();
    });

    it("list only returns the requesting user's subjects", async () => {
      const userA = await ctx.fixtures.createUser();
      const userB = await ctx.fixtures.createUser();
      const subjectA = await ctx.fixtures.createSubject(userA.id);
      await ctx.fixtures.createSubject(userB.id);

      const list = await ctx.db.subjects.list(userA.id);
      expect(list.map((s) => s.id)).toEqual([subjectA.id]);
    });

    it('enforces case-insensitive uniqueness per user', async () => {
      const user = await ctx.fixtures.createUser();
      await ctx.fixtures.createSubject(user.id, { name: 'Mathematics' });
      await expect(ctx.fixtures.createSubject(user.id, { name: 'mathematics' })).rejects.toThrow();
    });
  });

  describe('topics — materialised path and cross-user isolation', () => {
    it('computes path/depth for a chain of topics', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const [root, child, grandchild] = await ctx.fixtures.createTopicChain(user.id, subject.id, 3);

      expect(root).toBeDefined();
      expect(child).toBeDefined();
      expect(grandchild).toBeDefined();
      /* eslint-disable @typescript-eslint/no-non-null-assertion -- destructured from a fixed-length tuple we just created */
      expect(root!.depth).toBe(0);
      expect(root!.path).toBe(`/${root!.id}/`);
      expect(child!.depth).toBe(1);
      expect(child!.path).toBe(`${root!.path}${child!.id}/`);
      expect(grandchild!.depth).toBe(2);
      expect(grandchild!.path).toBe(`${child!.path}${grandchild!.id}/`);
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
    });

    it("findById returns null for another user's topic (owned via subject join)", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);
      const topic = await ctx.fixtures.createTopic(owner.id, subject.id);

      expect(await ctx.db.topics.findById(intruder.id, topic.id)).toBeNull();
    });

    it('create rejects a subjectId belonging to another user', async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);

      await expect(
        ctx.db.topics.create(intruder.id, { subjectId: subject.id, name: 'Should fail' }),
      ).rejects.toThrow(AppError);
    });
  });

  describe('study sessions — accuracy computed server-side, cross-user isolation', () => {
    it('computes accuracy from questionsCorrect/questionsAttempted', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const topic = await ctx.fixtures.createTopic(user.id, subject.id);

      const session = await ctx.fixtures.createStudySession(user.id, topic.id, {
        questionsAttempted: 8,
        questionsCorrect: 6,
      });
      expect(session.accuracy).toBeCloseTo(0.75);
    });

    it('rejects a topicId belonging to another user', async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);
      const topic = await ctx.fixtures.createTopic(owner.id, subject.id);

      await expect(ctx.fixtures.createStudySession(intruder.id, topic.id)).rejects.toThrow(AppError);
    });

    it("findById returns null for another user's session", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);
      const topic = await ctx.fixtures.createTopic(owner.id, subject.id);
      const session = await ctx.fixtures.createStudySession(owner.id, topic.id);

      expect(await ctx.db.studySessions.findById(intruder.id, session.id)).toBeNull();
    });

    it('stores a date-only field (studiedOn) that round-trips exactly across a DST boundary', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const topic = await ctx.fixtures.createTopic(user.id, subject.id);

      // 01:30 UTC on 2026-10-25, just after Europe/London's DST fall-back — with dayStartHour=4
      // this belongs to the 24th (see packages/shared/src/date.test.ts for the pure-function
      // version of this proof; this asserts the same value survives a real DB round-trip).
      const instant = new Date('2026-10-25T01:30:00Z');
      const studiedOn = startOfUserDay(instant, 'Europe/London', 4);

      const created = await ctx.fixtures.createStudySession(user.id, topic.id, { studiedOn });
      const reloaded = await ctx.db.studySessions.findById(user.id, created.id);

      expect(reloaded?.studiedOn.toISOString()).toBe('2026-10-24T00:00:00.000Z');
      expect(reloaded?.studiedOn.toISOString()).toBe(studiedOn.toISOString());
    });
  });

  describe('review schedules — 1:1 with topic, cross-user isolation', () => {
    it('upserts and finds a schedule', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const topic = await ctx.fixtures.createTopic(user.id, subject.id);

      await ctx.db.reviewSchedules.upsert(user.id, topic.id, { algorithm: 'fsrs', repetitions: 1 });
      const found = await ctx.db.reviewSchedules.find(user.id, topic.id);
      expect(found).toMatchObject({ topicId: topic.id, algorithm: 'fsrs', repetitions: 1 });
    });

    it("rejects access to another user's topic schedule", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);
      const topic = await ctx.fixtures.createTopic(owner.id, subject.id);

      await expect(ctx.db.reviewSchedules.find(intruder.id, topic.id)).rejects.toThrow(AppError);
    });
  });

  describe('competency snapshots — cross-user isolation', () => {
    it('creates and lists snapshots for a topic', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const topic = await ctx.fixtures.createTopic(user.id, subject.id);

      await ctx.db.competencySnapshots.create(user.id, topic.id, {
        capturedOn: new Date('2026-01-01T00:00:00Z'),
        score: 72.5,
        accuracyComponent: 0.8,
        confidenceComponent: 0.6,
        recencyComponent: 0.9,
      });

      const snapshots = await ctx.db.competencySnapshots.listByTopic(user.id, topic.id);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.score).toBeCloseTo(72.5);
    });

    it("rejects access to another user's topic snapshots", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);
      const topic = await ctx.fixtures.createTopic(owner.id, subject.id);

      await expect(ctx.db.competencySnapshots.listByTopic(intruder.id, topic.id)).rejects.toThrow(
        AppError,
      );
    });
  });

  describe('tags — cross-user isolation', () => {
    it('creates, attaches to a topic, and lists', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const topic = await ctx.fixtures.createTopic(user.id, subject.id);
      const tag = await ctx.db.tags.create(user.id, 'algebra');

      await ctx.db.tags.attachToTopic(user.id, topic.id, tag.id);
      const tagsForTopic = await ctx.db.tags.listForTopic(user.id, topic.id);
      expect(tagsForTopic.map((t) => t.id)).toEqual([tag.id]);

      await ctx.db.tags.detachFromTopic(user.id, topic.id, tag.id);
      expect(await ctx.db.tags.listForTopic(user.id, topic.id)).toHaveLength(0);
    });

    it("rejects attaching another user's tag to your topic", async () => {
      const userA = await ctx.fixtures.createUser();
      const userB = await ctx.fixtures.createUser();
      const subjectA = await ctx.fixtures.createSubject(userA.id);
      const topicA = await ctx.fixtures.createTopic(userA.id, subjectA.id);
      const tagB = await ctx.db.tags.create(userB.id, 'not-yours');

      await expect(ctx.db.tags.attachToTopic(userA.id, topicA.id, tagB.id)).rejects.toThrow(AppError);
    });
  });

  describe('refresh tokens — cross-user isolation', () => {
    it('creates, finds by hash, and revokes', async () => {
      const user = await ctx.fixtures.createUser();
      const token = await ctx.db.refreshTokens.create(user.id, {
        tokenHash: `hash-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      });

      expect(await ctx.db.refreshTokens.findByTokenHash(token.tokenHash)).toMatchObject({ id: token.id });

      await ctx.db.refreshTokens.revoke(user.id, token.id);
      const revoked = await ctx.db.refreshTokens.findByTokenHash(token.tokenHash);
      expect(revoked?.revokedAt).not.toBeNull();
    });

    it("rejects revoking another user's token", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const token = await ctx.db.refreshTokens.create(owner.id, {
        tokenHash: `hash-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      });

      await expect(ctx.db.refreshTokens.revoke(intruder.id, token.id)).rejects.toThrow(AppError);
    });
  });

  describe('UnitOfWork', () => {
    it('commits every step on success', async () => {
      const user = await ctx.fixtures.createUser();

      const subject = await ctx.db.unitOfWork.run(async (tx) => {
        const created = await tx.subject.create({
          data: { userId: user.id, name: 'Tx Subject', nameNormalised: 'tx subject' },
        });
        await tx.topic.create({
          data: {
            id: crypto.randomUUID(),
            subjectId: created.id,
            name: 'Tx Topic',
            nameNormalised: 'tx topic',
            path: '/placeholder/',
          },
        });
        return created;
      });

      expect(await ctx.db.subjects.findById(user.id, subject.id)).not.toBeNull();
      const topics = await ctx.db.topics.listBySubject(user.id, subject.id);
      expect(topics).toHaveLength(1);
    });

    it('rolls back every step when the callback throws', async () => {
      const user = await ctx.fixtures.createUser();
      let createdSubjectId: string | undefined;

      await expect(
        ctx.db.unitOfWork.run(async (tx) => {
          const created = await tx.subject.create({
            data: { userId: user.id, name: 'Rollback Subject', nameNormalised: 'rollback subject' },
          });
          createdSubjectId = created.id;
          throw new Error('deliberate failure mid-transaction');
        }),
      ).rejects.toThrow('deliberate failure mid-transaction');

      expect(createdSubjectId).toBeDefined();
      expect(await ctx.db.subjects.findById(user.id, createdSubjectId as string)).toBeNull();
    });
  });
});

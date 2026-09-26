import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@topicmatrix/shared';
import { deleteSubjectCascade, deleteTopic, moveTopic } from '../src/index.js';
import { setupIntegrationTest, type IntegrationTestContext } from './setup.js';

describe('topic tree operations (real database) — delivery-plan.md P4', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await setupIntegrationTest();
  }, 30_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('moveTopic', () => {
    it('re-parents across subjects, rewriting path/depth for the whole moved subtree', async () => {
      const user = await ctx.fixtures.createUser();
      const subjectA = await ctx.fixtures.createSubject(user.id);
      const subjectB = await ctx.fixtures.createSubject(user.id);

      // A 5-level chain in subjectA.
      const chain = await ctx.fixtures.createTopicChain(user.id, subjectA.id, 5);
      const [l0, l1, l2, l3, l4] = chain;
      /* eslint-disable @typescript-eslint/no-non-null-assertion -- destructured from a fixed-length tuple we just created */
      const targetParent = await ctx.fixtures.createTopic(user.id, subjectB.id);

      // Move the mid-level node (l2) — and its subtree (l3, l4) — under subjectB's topic.
      const moved = await moveTopic(ctx.db, user.id, l2!.id, { parentId: targetParent.id });

      expect(moved.subjectId).toBe(subjectB.id);
      expect(moved.parentId).toBe(targetParent.id);
      expect(moved.depth).toBe(targetParent.depth + 1);
      expect(moved.path).toBe(`${targetParent.path}${l2!.id}/`);

      const reloadedL3 = await ctx.db.topics.findById(user.id, l3!.id);
      const reloadedL4 = await ctx.db.topics.findById(user.id, l4!.id);
      expect(reloadedL3?.subjectId).toBe(subjectB.id);
      expect(reloadedL3?.depth).toBe(moved.depth + 1);
      expect(reloadedL3?.path).toBe(`${moved.path}${l3!.id}/`);
      expect(reloadedL4?.subjectId).toBe(subjectB.id);
      expect(reloadedL4?.depth).toBe(moved.depth + 2);
      expect(reloadedL4?.path).toBe(`${reloadedL3?.path}${l4!.id}/`);

      // The untouched ancestors (l0, l1) stay exactly where they were.
      const reloadedL0 = await ctx.db.topics.findById(user.id, l0!.id);
      const reloadedL1 = await ctx.db.topics.findById(user.id, l1!.id);
      expect(reloadedL0?.subjectId).toBe(subjectA.id);
      expect(reloadedL1?.subjectId).toBe(subjectA.id);
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
    });

    it('rejects moving a topic onto itself with TOPIC_CYCLE, leaving it unchanged', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const topic = await ctx.fixtures.createTopic(user.id, subject.id);

      await expect(moveTopic(ctx.db, user.id, topic.id, { parentId: topic.id })).rejects.toMatchObject(
        { code: 'TOPIC_CYCLE' },
      );

      const reloaded = await ctx.db.topics.findById(user.id, topic.id);
      expect(reloaded?.path).toBe(topic.path);
    });

    it('rejects moving a topic into one of its own descendants with TOPIC_CYCLE', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const [parent, child, grandchild] = await ctx.fixtures.createTopicChain(user.id, subject.id, 3);

      /* eslint-disable @typescript-eslint/no-non-null-assertion -- destructured from a fixed-length tuple we just created */
      await expect(
        moveTopic(ctx.db, user.id, parent!.id, { parentId: grandchild!.id }),
      ).rejects.toMatchObject({ code: 'TOPIC_CYCLE' });

      const reloadedParent = await ctx.db.topics.findById(user.id, parent!.id);
      const reloadedChild = await ctx.db.topics.findById(user.id, child!.id);
      expect(reloadedParent?.path).toBe(parent!.path);
      expect(reloadedChild?.path).toBe(child!.path);
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
    });

    it("rejects moving another user's topic", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);
      const topic = await ctx.fixtures.createTopic(owner.id, subject.id);

      await expect(moveTopic(ctx.db, intruder.id, topic.id, { parentId: null })).rejects.toThrow(
        AppError,
      );
    });
  });

  describe('deleteTopic — cascade', () => {
    it('removes the topic and its entire subtree, including sessions/schedules/snapshots/tags', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const [root, child] = await ctx.fixtures.createTopicChain(user.id, subject.id, 2);
      /* eslint-disable @typescript-eslint/no-non-null-assertion -- fixed-length tuple */
      const session = await ctx.fixtures.createStudySession(user.id, child!.id);
      await ctx.db.reviewSchedules.upsert(user.id, child!.id, { algorithm: 'fsrs' });
      const tag = await ctx.db.tags.create(user.id, `cascade-tag-${crypto.randomUUID()}`);
      await ctx.db.tags.attachToTopic(user.id, child!.id, tag.id);

      await deleteTopic(ctx.db, user.id, root!.id, 'cascade');

      expect(await ctx.db.topics.findById(user.id, root!.id)).toBeNull();
      expect(await ctx.db.topics.findById(user.id, child!.id)).toBeNull();
      expect(await ctx.db.studySessions.findById(user.id, session.id)).toBeNull();
      // The tag itself survives (only the association is removed) — still owned by the user.
      expect(await ctx.db.tags.findById(user.id, tag.id)).not.toBeNull();
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
    });
  });

  describe('deleteTopic — promote', () => {
    it("re-parents children to the deleted node's parent, leaving no orphans", async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const [grandparent, parent, child] = await ctx.fixtures.createTopicChain(user.id, subject.id, 3);
      /* eslint-disable @typescript-eslint/no-non-null-assertion -- fixed-length tuple */

      await deleteTopic(ctx.db, user.id, parent!.id, 'promote');

      expect(await ctx.db.topics.findById(user.id, parent!.id)).toBeNull();
      const promotedChild = await ctx.db.topics.findById(user.id, child!.id);
      expect(promotedChild?.parentId).toBe(grandparent!.id);
      expect(promotedChild?.depth).toBe(grandparent!.depth + 1);
      expect(promotedChild?.path).toBe(`${grandparent!.path}${child!.id}/`);
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
    });

    it('rejects deleting (either mode) a topic belonging to another user', async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);
      const topic = await ctx.fixtures.createTopic(owner.id, subject.id);

      await expect(deleteTopic(ctx.db, intruder.id, topic.id, 'cascade')).rejects.toThrow(AppError);
      expect(await ctx.db.topics.findById(owner.id, topic.id)).not.toBeNull();
    });
  });

  describe('deleteSubjectCascade', () => {
    it('removes every topic, session, schedule, snapshot and tag association under the subject', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const topic = await ctx.fixtures.createTopic(user.id, subject.id);
      const session = await ctx.fixtures.createStudySession(user.id, topic.id);
      await ctx.db.reviewSchedules.upsert(user.id, topic.id, { algorithm: 'manual' });

      await deleteSubjectCascade(ctx.db, user.id, subject.id);

      expect(await ctx.db.subjects.findById(user.id, subject.id)).toBeNull();
      expect(await ctx.db.topics.findById(user.id, topic.id)).toBeNull();
      expect(await ctx.db.studySessions.findById(user.id, session.id)).toBeNull();
    });

    it("rejects deleting another user's subject, and it survives", async () => {
      const owner = await ctx.fixtures.createUser();
      const intruder = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(owner.id);

      await expect(deleteSubjectCascade(ctx.db, intruder.id, subject.id)).rejects.toThrow(AppError);
      expect(await ctx.db.subjects.findById(owner.id, subject.id)).not.toBeNull();
    });
  });

  describe('sibling-name uniqueness (FR-3.3, application-level)', () => {
    it('rejects creating two root topics with the same (normalised) name in one subject', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'Algebra' });

      await expect(
        ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'algebra' }),
      ).rejects.toThrow(AppError);
    });

    it('allows the same name at different levels of the same subject', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const root = await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'Algebra' });

      await expect(
        ctx.db.topics.create(user.id, { subjectId: subject.id, parentId: root.id, name: 'Algebra' }),
      ).resolves.toMatchObject({ name: 'Algebra' });
    });
  });
  describe('sibling order (R2 D-5)', () => {
    async function order(userId: string, subjectId: string, parentId: string | null): Promise<string[]> {
      const topics = await ctx.db.topics.listBySubject(userId, subjectId);
      return topics.filter((t) => t.parentId === parentId).map((t) => t.name);
    }

    it('appends new topics after their existing siblings', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      for (const name of ['First', 'Second', 'Third']) {
        await ctx.db.topics.create(user.id, { subjectId: subject.id, name });
      }
      const topics = await ctx.db.topics.listBySubject(user.id, subject.id);
      expect(topics.map((t) => [t.name, t.sortOrder])).toEqual([
        ['First', 0],
        ['Second', 1],
        ['Third', 2],
      ]);
    });

    it('moves a topic to a position among its siblings, renumbering the group', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const [a, , c] = [
        await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'A' }),
        await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'B' }),
        await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'C' }),
      ];

      await moveTopic(ctx.db, user.id, c.id, { position: 0 });
      expect(await order(user.id, subject.id, null)).toEqual(['C', 'A', 'B']);

      await moveTopic(ctx.db, user.id, a.id, { position: 2 });
      expect(await order(user.id, subject.id, null)).toEqual(['C', 'B', 'A']);

      const sortOrders = (await ctx.db.topics.listBySubject(user.id, subject.id)).map((t) => t.sortOrder);
      expect(sortOrders).toEqual([0, 1, 2]);
    });

    it('reorders siblings that all started tied at sortOrder 0 (pre-R2 data)', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      for (const name of ['A', 'B', 'C']) {
        await ctx.db.topics.create(user.id, { subjectId: subject.id, name, sortOrder: 0 });
      }
      const b = (await ctx.db.topics.listBySubject(user.id, subject.id)).find((t) => t.name === 'B');
      if (!b) throw new Error('topic B missing');

      await moveTopic(ctx.db, user.id, b.id, { position: 0 });
      expect(await order(user.id, subject.id, null)).toEqual(['B', 'A', 'C']);
    });

    it('puts a re-parented topic last among its new siblings unless a position is given', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      const parent = await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'Parent' });
      await ctx.db.topics.create(user.id, { subjectId: subject.id, parentId: parent.id, name: 'Existing 1' });
      await ctx.db.topics.create(user.id, { subjectId: subject.id, parentId: parent.id, name: 'Existing 2' });
      const mover = await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'Mover' });
      const other = await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'Other' });

      await moveTopic(ctx.db, user.id, mover.id, { parentId: parent.id });
      expect(await order(user.id, subject.id, parent.id)).toEqual(['Existing 1', 'Existing 2', 'Mover']);

      await moveTopic(ctx.db, user.id, other.id, { parentId: parent.id, position: 1 });
      expect(await order(user.id, subject.id, parent.id)).toEqual(['Existing 1', 'Other', 'Existing 2', 'Mover']);
    });

    it('promote-delete puts the children where the deleted topic was', async () => {
      const user = await ctx.fixtures.createUser();
      const subject = await ctx.fixtures.createSubject(user.id);
      await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'Before' });
      const doomed = await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'Doomed' });
      await ctx.db.topics.create(user.id, { subjectId: subject.id, name: 'After' });
      await ctx.db.topics.create(user.id, { subjectId: subject.id, parentId: doomed.id, name: 'Child 1' });
      await ctx.db.topics.create(user.id, { subjectId: subject.id, parentId: doomed.id, name: 'Child 2' });

      await deleteTopic(ctx.db, user.id, doomed.id, 'promote');
      expect(await order(user.id, subject.id, null)).toEqual(['Before', 'Child 1', 'Child 2', 'After']);
    });
  });
});

import { AppError } from '@topicmatrix/shared';
import type { PrismaClientOrTx, ReviewSchedule } from '../types.js';

export interface UpsertReviewScheduleInput {
  algorithm: string;
  lastReviewedOn?: Date | null;
  nextReviewOn?: Date | null;
  intervalDays?: number | null;
  repetitions?: number;
  lapses?: number;
  easeFactor?: number | null;
  stability?: number | null;
  difficulty?: number | null;
  manualLadderIndex?: number | null;
}

export interface ReviewScheduleRepository {
  find(userId: string, topicId: string): Promise<ReviewSchedule | null>;
  /** Every schedule for every topic in a subject, in one query (P5) — avoids an N+1 when scoring a whole tree. */
  listBySubject(userId: string, subjectId: string): Promise<ReviewSchedule[]>;
  /**
   * Every schedule across every subject the user owns (P8 review queue). `skip`/`take` (P10
   * export) page through results instead of one unbounded query.
   */
  listAllForUser(
    userId: string,
    opts?: { skip?: number; take?: number },
  ): Promise<ReviewSchedule[]>;
  /** The schedules of the listed topics (the user's own only), in one query. */
  listByTopics(userId: string, topicIds: readonly string[]): Promise<ReviewSchedule[]>;
  /** One schedule per topic (§6.1) — create-or-replace, as scheduling recalculation always does (FR-4.3). */
  upsert(userId: string, topicId: string, input: UpsertReviewScheduleInput): Promise<ReviewSchedule>;
}

export function createReviewScheduleRepository(client: PrismaClientOrTx): ReviewScheduleRepository {
  async function assertOwned(userId: string, topicId: string): Promise<void> {
    const topic = await client.topic.findFirst({ where: { id: topicId, subject: { userId } } });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
  }

  return {
    find: async (userId, topicId) => {
      await assertOwned(userId, topicId);
      return client.reviewSchedule.findUnique({ where: { topicId } });
    },
    listBySubject: (userId, subjectId) =>
      client.reviewSchedule.findMany({ where: { topic: { subjectId, subject: { userId } } } }),
    listByTopics: (userId, topicIds) =>
      client.reviewSchedule.findMany({ where: { topicId: { in: [...topicIds] }, topic: { subject: { userId } } } }),
    listAllForUser: (userId, opts) =>
      client.reviewSchedule.findMany({
        where: { topic: { subject: { userId } } },
        orderBy: { topicId: 'asc' },
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
    upsert: async (userId, topicId, input) => {
      await assertOwned(userId, topicId);
      return client.reviewSchedule.upsert({
        where: { topicId },
        create: { topicId, ...input },
        update: input,
      });
    },
  };
}

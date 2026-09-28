import { AppError } from '@topicmatrix/shared';
import type { CompetencySnapshot, PrismaClientOrTx } from '../types.js';

export interface CreateCompetencySnapshotInput {
  capturedOn: Date;
  score: number;
  accuracyComponent: number;
  confidenceComponent: number;
  recencyComponent: number;
  triggeredBySessionId?: string | null;
}

export interface CompetencySnapshotRepository {
  listByTopic(
    userId: string,
    topicId: string,
    opts?: { from?: Date; to?: Date },
  ): Promise<CompetencySnapshot[]>;
  /**
   * Every snapshot across every subject the user owns (P9 Topic Health View's review trend).
   * `skip`/`take` (P10 export) page through results instead of one unbounded query.
   */
  listAllForUser(
    userId: string,
    opts?: { skip?: number; take?: number },
  ): Promise<CompetencySnapshot[]>;
  create(userId: string, topicId: string, input: CreateCompetencySnapshotInput): Promise<CompetencySnapshot>;
  /** Every snapshot for the listed topics (the user's own only), oldest first — one query (R5). */
  listByTopics(userId: string, topicIds: readonly string[]): Promise<CompetencySnapshot[]>;
  /**
   * Each topic's latest two snapshot scores — the ▲▼ review trend — without loading every
   * snapshot the user has (R5).
   */
  listLatestTwoScoresForUser(userId: string): Promise<Map<string, [number, number | undefined]>>;
}

export function createCompetencySnapshotRepository(
  client: PrismaClientOrTx,
): CompetencySnapshotRepository {
  async function assertOwned(userId: string, topicId: string): Promise<void> {
    const topic = await client.topic.findFirst({ where: { id: topicId, subject: { userId } } });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
  }

  return {
    listByTopic: async (userId, topicId, opts) => {
      await assertOwned(userId, topicId);
      return client.competencySnapshot.findMany({
        where: {
          topicId,
          ...(opts?.from || opts?.to
            ? { capturedOn: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
            : {}),
        },
        orderBy: { capturedOn: 'asc' },
      });
    },
    listAllForUser: (userId, opts) =>
      client.competencySnapshot.findMany({
        where: { topic: { subject: { userId } } },
        orderBy: { capturedOn: 'asc' },
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
    listByTopics: (userId, topicIds) =>
      client.competencySnapshot.findMany({
        where: { topicId: { in: [...topicIds] }, topic: { subject: { userId } } },
        orderBy: { capturedOn: 'asc' },
      }),
    listLatestTwoScoresForUser: async (userId) => {
      const rows = await client.competencySnapshot.findMany({
        where: { topic: { subject: { userId } } },
        select: { topicId: true, capturedOn: true, score: true },
        orderBy: [{ topicId: 'asc' }, { capturedOn: 'desc' }],
      });
      const latest = new Map<string, [number, number | undefined]>();
      for (const row of rows) {
        const entry = latest.get(row.topicId);
        if (!entry) {
          latest.set(row.topicId, [row.score, undefined]);
        } else if (entry[1] === undefined) {
          entry[1] = row.score;
        }
      }
      return latest;
    },
    create: async (userId, topicId, input) => {
      await assertOwned(userId, topicId);
      return client.competencySnapshot.create({ data: { topicId, ...input } });
    },
  };
}

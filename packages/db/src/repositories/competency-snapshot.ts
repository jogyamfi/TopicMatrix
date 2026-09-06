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
  create(userId: string, topicId: string, input: CreateCompetencySnapshotInput): Promise<CompetencySnapshot>;
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
    create: async (userId, topicId, input) => {
      await assertOwned(userId, topicId);
      return client.competencySnapshot.create({ data: { topicId, ...input } });
    },
  };
}

import { AppError, normaliseKey } from '@topicmatrix/shared';
import type { PrismaClientOrTx, Topic } from '../types.js';

export interface CreateTopicInput {
  subjectId: string;
  parentId?: string | null;
  name: string;
  notes?: string | null;
  sortOrder?: number;
  algorithmOverride?: string | null;
}

export type UpdateTopicInput = Partial<
  Pick<CreateTopicInput, 'name' | 'notes' | 'sortOrder' | 'algorithmOverride'>
> & { isSuspended?: boolean };

export interface TopicRepository {
  listBySubject(userId: string, subjectId: string): Promise<Topic[]>;
  /**
   * Every topic across every subject the user owns (P8 review queue) — avoids an N+1
   * per-subject scan. `skip`/`take` (P10 export) page through results instead of one
   * unbounded query.
   */
  listAllForUser(userId: string, opts?: { skip?: number; take?: number }): Promise<Topic[]>;
  findById(userId: string, topicId: string): Promise<Topic | null>;
  /**
   * Creates a topic and computes its materialised `path`/`depth` from its parent (or as a new
   * root). Full subtree move/re-parent logic (cycle prevention, batch path rewrites) is P4 scope
   * (delivery-plan.md P4 task 4-5) — this only covers the initial, always-correct insert case.
   */
  create(userId: string, input: CreateTopicInput): Promise<Topic>;
  update(userId: string, topicId: string, patch: UpdateTopicInput): Promise<Topic>;
  delete(userId: string, topicId: string): Promise<void>;
}

export function createTopicRepository(client: PrismaClientOrTx): TopicRepository {
  async function findOwned(userId: string, topicId: string): Promise<Topic> {
    const topic = await client.topic.findFirst({ where: { id: topicId, subject: { userId } } });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    return topic;
  }

  return {
    listBySubject: (userId, subjectId) =>
      client.topic.findMany({
        where: { subjectId, subject: { userId } },
        orderBy: { sortOrder: 'asc' },
      }),
    listAllForUser: (userId, opts) =>
      client.topic.findMany({
        where: { subject: { userId } },
        orderBy: { sortOrder: 'asc' },
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
    findById: (userId, topicId) =>
      client.topic.findFirst({ where: { id: topicId, subject: { userId } } }),
    create: async (userId, input) => {
      const subject = await client.subject.findFirst({
        where: { id: input.subjectId, userId },
      });
      if (!subject) {
        throw new AppError('NOT_FOUND', 'Subject not found');
      }

      let path: string;
      let depth: number;
      if (input.parentId) {
        const parent = await client.topic.findFirst({
          where: { id: input.parentId, subjectId: input.subjectId, subject: { userId } },
        });
        if (!parent) {
          throw new AppError('NOT_FOUND', 'Parent topic not found');
        }
        path = parent.path;
        depth = parent.depth + 1;
      } else {
        path = '/';
        depth = 0;
      }

      // Sibling-name uniqueness (FR-3.3) is an application-level check, not a DB constraint —
      // see prisma/model.prisma's comment on why (NULL-distinctness on root-level topics).
      const nameNormalised = normaliseKey(input.name);
      const sibling = await client.topic.findFirst({
        where: { subjectId: input.subjectId, parentId: input.parentId ?? null, nameNormalised },
      });
      if (sibling) {
        throw new AppError('CONFLICT', 'A sibling topic with this name already exists');
      }

      // Generated up front (rather than left to Prisma's @default(cuid())) so it can be folded
      // into `path` before the row is inserted.
      const id = crypto.randomUUID();
      return client.topic.create({
        data: {
          id,
          subjectId: input.subjectId,
          parentId: input.parentId ?? null,
          name: input.name,
          nameNormalised,
          notes: input.notes ?? null,
          sortOrder: input.sortOrder ?? 0,
          algorithmOverride: input.algorithmOverride ?? null,
          depth,
          path: `${path}${id}/`,
        },
      });
    },
    update: async (userId, topicId, patch) => {
      const existing = await findOwned(userId, topicId);
      const { name, ...rest } = patch;
      if (name === undefined) {
        return client.topic.update({ where: { id: topicId }, data: rest });
      }
      const nameNormalised = normaliseKey(name);
      const sibling = await client.topic.findFirst({
        where: {
          subjectId: existing.subjectId,
          parentId: existing.parentId,
          nameNormalised,
          NOT: { id: topicId },
        },
      });
      if (sibling) {
        throw new AppError('CONFLICT', 'A sibling topic with this name already exists');
      }
      return client.topic.update({
        where: { id: topicId },
        data: { ...rest, name, nameNormalised },
      });
    },
    delete: async (userId, topicId) => {
      await findOwned(userId, topicId);
      await client.topic.delete({ where: { id: topicId } });
    },
  };
}

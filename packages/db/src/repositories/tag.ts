import { AppError, normaliseKey } from '@topicmatrix/shared';
import type { PrismaClientOrTx, Tag, Topic } from '../types.js';

export interface TopicTagLink {
  topicId: string;
  tagId: string;
}

export interface TagRepository {
  /** `skip`/`take` (P10 export) page through results instead of one unbounded query. */
  list(userId: string, opts?: { skip?: number; take?: number }): Promise<Tag[]>;
  findById(userId: string, tagId: string): Promise<Tag | null>;
  create(userId: string, name: string): Promise<Tag>;
  delete(userId: string, tagId: string): Promise<void>;
  listForTopic(userId: string, topicId: string): Promise<Tag[]>;
  /** Cross-subject filtering (FR-3.9) — every topic (in any subject) tagged with this tag. */
  topicsForTag(userId: string, tagId: string): Promise<Topic[]>;
  attachToTopic(userId: string, topicId: string, tagId: string): Promise<void>;
  detachFromTopic(userId: string, topicId: string, tagId: string): Promise<void>;
  /** Every topic-tag attachment across every subject the user owns (P10 export). */
  listAllTopicTagsForUser(
    userId: string,
    opts?: { skip?: number; take?: number },
  ): Promise<TopicTagLink[]>;
}

export function createTagRepository(client: PrismaClientOrTx): TagRepository {
  async function assertTopicOwned(userId: string, topicId: string): Promise<void> {
    const topic = await client.topic.findFirst({ where: { id: topicId, subject: { userId } } });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
  }

  async function assertTagOwned(userId: string, tagId: string): Promise<void> {
    const tag = await client.tag.findFirst({ where: { id: tagId, userId } });
    if (!tag) {
      throw new AppError('NOT_FOUND', 'Tag not found');
    }
  }

  return {
    list: (userId, opts) =>
      client.tag.findMany({
        where: { userId },
        orderBy: { name: 'asc' },
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
    findById: (userId, tagId) => client.tag.findFirst({ where: { id: tagId, userId } }),
    create: async (userId, name) => {
      const nameNormalised = normaliseKey(name);
      const conflict = await client.tag.findFirst({ where: { userId, nameNormalised } });
      if (conflict) {
        throw new AppError('CONFLICT', 'A tag with this name already exists');
      }
      return client.tag.create({ data: { userId, name, nameNormalised } });
    },
    delete: async (userId, tagId) => {
      await assertTagOwned(userId, tagId);
      await client.tag.delete({ where: { id: tagId } });
    },
    listForTopic: async (userId, topicId) => {
      await assertTopicOwned(userId, topicId);
      const topicTags = await client.topicTag.findMany({ where: { topicId }, include: { tag: true } });
      return topicTags.map((tt) => tt.tag);
    },
    topicsForTag: async (userId, tagId) => {
      await assertTagOwned(userId, tagId);
      const topicTags = await client.topicTag.findMany({ where: { tagId }, include: { topic: true } });
      return topicTags.map((tt) => tt.topic);
    },
    attachToTopic: async (userId, topicId, tagId) => {
      await Promise.all([assertTopicOwned(userId, topicId), assertTagOwned(userId, tagId)]);
      await client.topicTag.upsert({
        where: { topicId_tagId: { topicId, tagId } },
        create: { topicId, tagId },
        update: {},
      });
    },
    detachFromTopic: async (userId, topicId, tagId) => {
      await Promise.all([assertTopicOwned(userId, topicId), assertTagOwned(userId, tagId)]);
      await client.topicTag.deleteMany({ where: { topicId, tagId } });
    },
    listAllTopicTagsForUser: (userId, opts) =>
      client.topicTag.findMany({
        where: { topic: { subject: { userId } } },
        select: { topicId: true, tagId: true },
        orderBy: { topicId: 'asc' },
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
  };
}

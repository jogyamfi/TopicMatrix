import { AppError, normaliseKey } from '@topicmatrix/shared';
import type { PrismaClientOrTx, Tag } from '../types.js';

export interface TagRepository {
  list(userId: string): Promise<Tag[]>;
  findById(userId: string, tagId: string): Promise<Tag | null>;
  create(userId: string, name: string): Promise<Tag>;
  delete(userId: string, tagId: string): Promise<void>;
  listForTopic(userId: string, topicId: string): Promise<Tag[]>;
  attachToTopic(userId: string, topicId: string, tagId: string): Promise<void>;
  detachFromTopic(userId: string, topicId: string, tagId: string): Promise<void>;
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
    list: (userId) => client.tag.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
    findById: (userId, tagId) => client.tag.findFirst({ where: { id: tagId, userId } }),
    create: (userId, name) =>
      client.tag.create({ data: { userId, name, nameNormalised: normaliseKey(name) } }),
    delete: async (userId, tagId) => {
      await assertTagOwned(userId, tagId);
      await client.tag.delete({ where: { id: tagId } });
    },
    listForTopic: async (userId, topicId) => {
      await assertTopicOwned(userId, topicId);
      const topicTags = await client.topicTag.findMany({ where: { topicId }, include: { tag: true } });
      return topicTags.map((tt) => tt.tag);
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
  };
}

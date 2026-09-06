import { AppError, normaliseKey } from '@topicmatrix/shared';
import type { PrismaClientOrTx, Subject } from '../types.js';

export interface CreateSubjectInput {
  name: string;
  description?: string | null;
  colour?: string | null;
  icon?: string | null;
  sortOrder?: number;
  defaultAlgorithm?: string | null;
}

export type UpdateSubjectInput = Partial<CreateSubjectInput> & { isArchived?: boolean };

export interface SubjectRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<Subject[]>;
  /** Returns null (never throws) for a missing OR not-owned id — callers must not distinguish. */
  findById(userId: string, subjectId: string): Promise<Subject | null>;
  create(userId: string, input: CreateSubjectInput): Promise<Subject>;
  update(userId: string, subjectId: string, patch: UpdateSubjectInput): Promise<Subject>;
  delete(userId: string, subjectId: string): Promise<void>;
}

export function createSubjectRepository(client: PrismaClientOrTx): SubjectRepository {
  async function findOwned(userId: string, subjectId: string): Promise<Subject> {
    const subject = await client.subject.findFirst({ where: { id: subjectId, userId } });
    if (!subject) {
      throw new AppError('NOT_FOUND', 'Subject not found');
    }
    return subject;
  }

  return {
    list: (userId, opts) =>
      client.subject.findMany({
        where: { userId, ...(opts?.includeArchived ? {} : { isArchived: false }) },
        orderBy: { sortOrder: 'asc' },
      }),
    findById: (userId, subjectId) => client.subject.findFirst({ where: { id: subjectId, userId } }),
    create: (userId, input) =>
      client.subject.create({
        data: { userId, nameNormalised: normaliseKey(input.name), ...input },
      }),
    update: async (userId, subjectId, patch) => {
      await findOwned(userId, subjectId);
      const { name, ...rest } = patch;
      return client.subject.update({
        where: { id: subjectId },
        data: {
          ...rest,
          ...(name !== undefined ? { name, nameNormalised: normaliseKey(name) } : {}),
        },
      });
    },
    delete: async (userId, subjectId) => {
      await findOwned(userId, subjectId);
      await client.subject.delete({ where: { id: subjectId } });
    },
  };
}

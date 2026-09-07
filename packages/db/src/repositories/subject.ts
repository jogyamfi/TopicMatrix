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
  /** `skip`/`take` (P10 export) page through results instead of one unbounded query. */
  list(
    userId: string,
    opts?: { includeArchived?: boolean; skip?: number; take?: number },
  ): Promise<Subject[]>;
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
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
    findById: (userId, subjectId) => client.subject.findFirst({ where: { id: subjectId, userId } }),
    create: async (userId, input) => {
      const nameNormalised = normaliseKey(input.name);
      // Pre-check rather than catching the DB's unique-constraint error (same convention as
      // admin-users.ts) — case-insensitive uniqueness per user (FR-2.2).
      const conflict = await client.subject.findFirst({ where: { userId, nameNormalised } });
      if (conflict) {
        throw new AppError('CONFLICT', 'A subject with this name already exists');
      }
      return client.subject.create({ data: { userId, nameNormalised, ...input } });
    },
    update: async (userId, subjectId, patch) => {
      await findOwned(userId, subjectId);
      const { name, ...rest } = patch;
      if (name === undefined) {
        return client.subject.update({ where: { id: subjectId }, data: rest });
      }
      const nameNormalised = normaliseKey(name);
      const conflict = await client.subject.findFirst({
        where: { userId, nameNormalised, NOT: { id: subjectId } },
      });
      if (conflict) {
        throw new AppError('CONFLICT', 'A subject with this name already exists');
      }
      return client.subject.update({
        where: { id: subjectId },
        data: { ...rest, name, nameNormalised },
      });
    },
    delete: async (userId, subjectId) => {
      await findOwned(userId, subjectId);
      await client.subject.delete({ where: { id: subjectId } });
    },
  };
}

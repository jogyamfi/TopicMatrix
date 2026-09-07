import { AppError } from '@topicmatrix/shared';
import type { PrismaClientOrTx, StudySession } from '../types.js';

export interface CreateStudySessionInput {
  topicId: string;
  studiedOn: Date;
  sourceLabel?: string | null;
  questionsAttempted: number;
  questionsCorrect: number;
  confidence: number;
  durationMinutes?: number | null;
  notes?: string | null;
  gradeUsed?: number | null;
}

export type UpdateStudySessionInput = Partial<
  Omit<CreateStudySessionInput, 'topicId'>
>;

export interface StudySessionRepository {
  listByTopic(userId: string, topicId: string): Promise<StudySession[]>;
  /** Every session for every topic in a subject, in one query (P5) — avoids an N+1 when scoring a whole tree. */
  listBySubject(userId: string, subjectId: string): Promise<StudySession[]>;
  /**
   * Every session across every subject the user owns (P8 review queue). `skip`/`take` (P10
   * export) page through results instead of one unbounded query.
   */
  listAllForUser(userId: string, opts?: { skip?: number; take?: number }): Promise<StudySession[]>;
  findById(userId: string, sessionId: string): Promise<StudySession | null>;
  /** `accuracy` is always computed here from questionsCorrect/questionsAttempted (FR-4.2) — never accepted as input. */
  create(userId: string, input: CreateStudySessionInput): Promise<StudySession>;
  update(userId: string, sessionId: string, patch: UpdateStudySessionInput): Promise<StudySession>;
  delete(userId: string, sessionId: string): Promise<void>;
}

function computeAccuracy(questionsAttempted: number, questionsCorrect: number): number {
  if (questionsAttempted <= 0) {
    throw new AppError('VALIDATION_FAILED', 'questionsAttempted must be at least 1');
  }
  if (questionsCorrect < 0 || questionsCorrect > questionsAttempted) {
    throw new AppError('VALIDATION_FAILED', 'questionsCorrect must be between 0 and questionsAttempted');
  }
  return questionsCorrect / questionsAttempted;
}

export function createStudySessionRepository(client: PrismaClientOrTx): StudySessionRepository {
  async function findOwned(userId: string, sessionId: string): Promise<StudySession> {
    const session = await client.studySession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      throw new AppError('NOT_FOUND', 'Study session not found');
    }
    return session;
  }

  return {
    listByTopic: (userId, topicId) =>
      client.studySession.findMany({
        where: { topicId, userId },
        orderBy: { studiedOn: 'desc' },
      }),
    listBySubject: (userId, subjectId) =>
      client.studySession.findMany({
        where: { userId, topic: { subjectId } },
        orderBy: { studiedOn: 'desc' },
      }),
    listAllForUser: (userId, opts) =>
      client.studySession.findMany({
        where: { userId },
        orderBy: { studiedOn: 'desc' },
        ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
        ...(opts?.take !== undefined ? { take: opts.take } : {}),
      }),
    findById: (userId, sessionId) => client.studySession.findFirst({ where: { id: sessionId, userId } }),
    create: async (userId, input) => {
      const topic = await client.topic.findFirst({
        where: { id: input.topicId, subject: { userId } },
      });
      if (!topic) {
        throw new AppError('NOT_FOUND', 'Topic not found');
      }
      return client.studySession.create({
        data: {
          ...input,
          userId,
          accuracy: computeAccuracy(input.questionsAttempted, input.questionsCorrect),
        },
      });
    },
    update: async (userId, sessionId, patch) => {
      const existing = await findOwned(userId, sessionId);
      const questionsAttempted = patch.questionsAttempted ?? existing.questionsAttempted;
      const questionsCorrect = patch.questionsCorrect ?? existing.questionsCorrect;
      return client.studySession.update({
        where: { id: sessionId },
        data: { ...patch, accuracy: computeAccuracy(questionsAttempted, questionsCorrect) },
      });
    },
    delete: async (userId, sessionId) => {
      await findOwned(userId, sessionId);
      await client.studySession.delete({ where: { id: sessionId } });
    },
  };
}

import { AppError } from '@topicmatrix/shared';
import type { Db } from './db.js';
import {
  createStudySessionRepository,
  type CreateStudySessionInput,
  type UpdateStudySessionInput,
} from './repositories/study-session.js';
import { recalculateTopicScheduleInTx, type RecalculationResult } from './scheduling.js';
import type { StudySession } from './types.js';

// Every session write and the schedule/snapshot recalculation it triggers commit together, in
// one UnitOfWork: a failed recalculation must not leave a session saved against a stale schedule
// (and vice versa). On D1 these become fixed `DB.batch()` candidates at P11 (see unit-of-work.ts).

export interface SessionWriteResult {
  session: StudySession;
  recalculation: RecalculationResult;
}

export function logStudySession(
  db: Db,
  userId: string,
  input: CreateStudySessionInput,
): Promise<SessionWriteResult> {
  return db.unitOfWork.run(async (tx) => {
    const session = await createStudySessionRepository(tx).create(userId, input);
    const recalculation = await recalculateTopicScheduleInTx(tx, userId, input.topicId);
    return { session, recalculation };
  });
}

export function updateStudySession(
  db: Db,
  userId: string,
  sessionId: string,
  patch: UpdateStudySessionInput,
): Promise<SessionWriteResult> {
  return db.unitOfWork.run(async (tx) => {
    const session = await createStudySessionRepository(tx).update(userId, sessionId, patch);
    const recalculation = await recalculateTopicScheduleInTx(tx, userId, session.topicId);
    return { session, recalculation };
  });
}

export function deleteStudySession(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<{ recalculation: RecalculationResult }> {
  return db.unitOfWork.run(async (tx) => {
    const sessions = createStudySessionRepository(tx);
    const existing = await sessions.findById(userId, sessionId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Study session not found');
    }
    await sessions.delete(userId, sessionId);
    const recalculation = await recalculateTopicScheduleInTx(tx, userId, existing.topicId);
    return { recalculation };
  });
}

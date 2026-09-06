import { AppError, startOfUserDay } from '@topicmatrix/shared';
import type { Db } from './db.js';
import { computeSubjectTopicMetrics } from './topic-metrics.js';

/**
 * Subject-card summary (FR-2.5, delivery-plan.md P7 task 1): topic count, an aggregate
 * competency figure, a due-today count and the most recent session date. `aggregateScore` is
 * the unweighted mean of the subject's own root topics' `aggregateScore` (each root's own
 * aggregate already covers its whole descendant subtree, and the roots partition every topic in
 * the subject via the materialised path — so this is a whole-subject figure without re-deriving
 * `packages/core`'s roll-up math a second time here).
 */
export interface SubjectSummary {
  readonly topicCount: number;
  readonly aggregateScore: number | null;
  readonly dueTodayCount: number;
  readonly lastActivityOn: Date | null;
}

export async function computeSubjectSummary(
  db: Db,
  userId: string,
  subjectId: string,
  asOfDate: Date,
): Promise<SubjectSummary> {
  const topics = await db.topics.listBySubject(userId, subjectId);
  if (topics.length === 0) {
    return { topicCount: 0, aggregateScore: null, dueTodayCount: 0, lastActivityOn: null };
  }

  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }

  const [sessions, schedules, metrics] = await Promise.all([
    db.studySessions.listBySubject(userId, subjectId),
    db.reviewSchedules.listBySubject(userId, subjectId),
    computeSubjectTopicMetrics(db, userId, subjectId, topics, asOfDate),
  ]);

  const rootScores = topics
    .filter((t) => t.parentId === null)
    .map((t) => metrics.get(t.id)?.aggregateScore ?? null)
    .filter((score): score is number => score !== null);
  const aggregateScore =
    rootScores.length > 0 ? rootScores.reduce((sum, s) => sum + s, 0) / rootScores.length : null;

  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);
  const dueTodayCount = schedules.filter(
    (s) => !s.isSuspended && s.nextReviewOn !== null && s.nextReviewOn.getTime() <= today.getTime(),
  ).length;

  let lastActivityOn: Date | null = null;
  for (const session of sessions) {
    if (!lastActivityOn || session.studiedOn > lastActivityOn) {
      lastActivityOn = session.studiedOn;
    }
  }

  return { topicCount: topics.length, aggregateScore, dueTodayCount, lastActivityOn };
}

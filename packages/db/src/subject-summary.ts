import { AppError, startOfUserDay } from '@topicmatrix/shared';
import type { Db } from './db.js';
import { computeTopicMetricsFromData } from './topic-metrics.js';
import type { Subject, Topic } from './types.js';

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

const EMPTY_SUMMARY: SubjectSummary = { topicCount: 0, aggregateScore: null, dueTodayCount: 0, lastActivityOn: null };

/**
 * Summaries for every listed subject from ONE bulk read of the user's topics, schedules and lean
 * session rows (R5, NF-1). The previous per-subject version issued ~6 queries per subject — two of
 * them full session reads — and ran the subjects concurrently, which on SQLite made them contend:
 * 5.8 s p50 for 20 subjects / 20,000 sessions.
 */
export async function computeSubjectSummaries(
  db: Db,
  userId: string,
  subjects: readonly Subject[],
  asOfDate: Date,
): Promise<Map<string, SubjectSummary>> {
  const summaries = new Map<string, SubjectSummary>();
  if (subjects.length === 0) {
    return summaries;
  }
  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }
  const [topics, schedules, sessions] = await Promise.all([
    db.topics.listAllForUser(userId),
    db.reviewSchedules.listAllForUser(userId),
    db.studySessions.listScoringRowsForUser(userId),
  ]);

  const topicsBySubject = new Map<string, Topic[]>();
  for (const topic of topics) {
    const list = topicsBySubject.get(topic.subjectId);
    if (list) list.push(topic);
    else topicsBySubject.set(topic.subjectId, [topic]);
  }
  const subjectIdByTopic = new Map(topics.map((t) => [t.id, t.subjectId]));
  const groupBySubject = <T extends { topicId: string }>(rows: readonly T[]): Map<string, T[]> => {
    const bySubject = new Map<string, T[]>();
    for (const row of rows) {
      const subjectId = subjectIdByTopic.get(row.topicId);
      if (!subjectId) continue;
      const list = bySubject.get(subjectId);
      if (list) list.push(row);
      else bySubject.set(subjectId, [row]);
    }
    return bySubject;
  };
  const sessionsBySubject = groupBySubject(sessions);
  const schedulesBySubject = groupBySubject(schedules);

  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);

  for (const subject of subjects) {
    const subjectTopics = topicsBySubject.get(subject.id) ?? [];
    if (subjectTopics.length === 0) {
      summaries.set(subject.id, EMPTY_SUMMARY);
      continue;
    }
    const subjectSessions = sessionsBySubject.get(subject.id) ?? [];
    const subjectSchedules = schedulesBySubject.get(subject.id) ?? [];
    const metrics = computeTopicMetricsFromData(subjectTopics, subjectSessions, subjectSchedules, settings, asOfDate);

    const rootScores = subjectTopics
      .filter((t) => t.parentId === null)
      .map((t) => metrics.get(t.id)?.aggregateScore ?? null)
      .filter((score): score is number => score !== null);
    const aggregateScore =
      rootScores.length > 0 ? rootScores.reduce((sum, s) => sum + s, 0) / rootScores.length : null;

    // Same eligibility as the review queue: suspended topics are never "due".
    const dueTopicIds = new Set(subjectTopics.filter((t) => !t.isSuspended).map((t) => t.id));
    const dueTodayCount = subjectSchedules.filter(
      (s) => dueTopicIds.has(s.topicId) && s.nextReviewOn !== null && s.nextReviewOn.getTime() <= today.getTime(),
    ).length;

    summaries.set(subject.id, {
      topicCount: subjectTopics.length,
      aggregateScore,
      dueTodayCount,
      lastActivityOn: subjectSessions.reduce<Date | null>(
        (last, session) => (!last || session.studiedOn > last ? session.studiedOn : last),
        null,
      ),
    });
  }
  return summaries;
}

/** One subject's summary (a convenience over `computeSubjectSummaries`). */
export async function computeSubjectSummary(
  db: Db,
  userId: string,
  subjectId: string,
  asOfDate: Date,
): Promise<SubjectSummary> {
  const subject = await db.subjects.findById(userId, subjectId);
  if (!subject) {
    throw new AppError('NOT_FOUND', 'Subject not found');
  }
  return (await computeSubjectSummaries(db, userId, [subject], asOfDate)).get(subjectId) ?? EMPTY_SUMMARY;
}

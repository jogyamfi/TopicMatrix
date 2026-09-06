import { AppError, startOfUserDay } from '@topicmatrix/shared';
import { computeCompetencyScore, computeHealthStatus, computeRollupScore, daysBetween } from '@topicmatrix/core';
import type { Db } from './db.js';
import type { StudySession, Topic } from './types.js';

/**
 * Own vs aggregate competency metrics (FR-3.8) — the P4 handover's real replacement for
 * `placeholderTopicMetrics()`. Scores are computed live, as of `asOfDate` (§7.6 "score-on-read":
 * the recency term decays with time even between sessions, so a stored value would go stale —
 * `CompetencySnapshot` rows are for history/trend charts, never for current display).
 */
export interface TopicScoreMetrics {
  readonly ownScore: number | null;
  readonly aggregateScore: number | null;
  readonly ownHealthStatus: string | null;
  readonly aggregateHealthStatus: string | null;
}

const ROLLUP_WINDOW_DAYS = 180;
const MS_PER_DAY = 86_400_000;

const HEALTH_SEVERITY: Record<string, number> = {
  notStarted: 0,
  strong: 1,
  needsReview: 2,
  atRisk: 3,
};

/** Aggregate health is the most severe status among a topic and its descendants (§7.4/§7.3). */
function worstHealthStatus(statuses: readonly string[]): string {
  return statuses.reduce(
    (worst, status) => ((HEALTH_SEVERITY[status] ?? 0) > (HEALTH_SEVERITY[worst] ?? 0) ? status : worst),
    'notStarted',
  );
}

/**
 * Computes own + aggregate score/health for every topic in `topics` (expected to be every topic
 * in one subject, per `TopicRepository.listBySubject`), in two bulk queries rather than one pair
 * of queries per topic (`StudySessionRepository`/`ReviewScheduleRepository`'s `listBySubject`).
 * Aggregate metrics use the materialised `path` prefix to find each topic's descendants (§7.3),
 * the same technique `topic-tree.ts` uses for move/delete.
 */
/** `own` is populated for every id in `topics` by the loop above it — this just avoids a banned `!`. */
function mustGetOwn<V>(map: Map<string, V>, topicId: string): V {
  const value = map.get(topicId);
  if (value === undefined) {
    throw new Error(`Internal error: no own-metrics entry computed for topic ${topicId}`);
  }
  return value;
}

export async function computeSubjectTopicMetrics(
  db: Db,
  userId: string,
  subjectId: string,
  topics: readonly Topic[],
  asOfDate: Date,
): Promise<Map<string, TopicScoreMetrics>> {
  const result = new Map<string, TopicScoreMetrics>();
  if (topics.length === 0) {
    return result;
  }

  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }

  const [sessions, schedules] = await Promise.all([
    db.studySessions.listBySubject(userId, subjectId),
    db.reviewSchedules.listBySubject(userId, subjectId),
  ]);

  const sessionsByTopic = new Map<string, StudySession[]>();
  for (const session of sessions) {
    const list = sessionsByTopic.get(session.topicId) ?? [];
    list.push(session);
    sessionsByTopic.set(session.topicId, list);
  }
  const scheduleByTopic = new Map(schedules.map((s) => [s.topicId, s]));

  const weights = {
    accuracy: settings.weightAccuracy,
    confidence: settings.weightConfidence,
    recency: settings.weightRecency,
  };
  const rollupWindowStart = new Date(asOfDate.getTime() - ROLLUP_WINDOW_DAYS * MS_PER_DAY);
  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);

  const own = new Map<
    string,
    { score: number | null; health: string; questionsAttempted180d: number }
  >();

  for (const topic of topics) {
    const topicSessions = sessionsByTopic.get(topic.id) ?? [];
    const schedule = scheduleByTopic.get(topic.id) ?? null;

    const scoreResult = computeCompetencyScore({
      sessions: topicSessions.map((s) => ({
        studiedOn: s.studiedOn,
        questionsAttempted: s.questionsAttempted,
        accuracy: s.accuracy,
        confidence: s.confidence,
      })),
      asOfDate,
      currentIntervalDays: schedule?.intervalDays ?? null,
      weights,
    });

    let lastSessionOn: Date | null = null;
    let questionsAttempted180d = 0;
    for (const session of topicSessions) {
      if (!lastSessionOn || session.studiedOn > lastSessionOn) {
        lastSessionOn = session.studiedOn;
      }
      if (session.studiedOn >= rollupWindowStart) {
        questionsAttempted180d += session.questionsAttempted;
      }
    }

    const overdueDays = schedule?.nextReviewOn
      ? Math.max(0, Math.round(daysBetween(schedule.nextReviewOn, today)))
      : 0;
    const health = computeHealthStatus({
      score: scoreResult.score,
      overdueDays,
      daysSinceLastSession: lastSessionOn ? daysBetween(lastSessionOn, asOfDate) : null,
      strongThreshold: settings.strongThreshold,
      needsReviewThreshold: settings.needsReviewThreshold,
      neglectThresholdDays: settings.neglectThresholdDays,
    });

    own.set(topic.id, { score: scoreResult.score, health, questionsAttempted180d });
  }

  for (const topic of topics) {
    const descendants = topics.filter((t) => t.path.startsWith(topic.path));
    const descendantOwn = descendants.map((d) => mustGetOwn(own, d.id));
    const aggregateScore = computeRollupScore(
      descendantOwn.map((d) => ({ score: d.score, questionsAttempted180d: d.questionsAttempted180d })),
    );
    const aggregateHealthStatus = worstHealthStatus(descendantOwn.map((d) => d.health));
    const ownMetrics = mustGetOwn(own, topic.id);

    result.set(topic.id, {
      ownScore: ownMetrics.score,
      aggregateScore,
      ownHealthStatus: ownMetrics.health,
      aggregateHealthStatus,
    });
  }

  return result;
}

/** Single-topic convenience wrapper — loads the topic's whole subject to compute its roll-up. */
export async function computeTopicMetrics(
  db: Db,
  userId: string,
  topicId: string,
  asOfDate: Date,
): Promise<TopicScoreMetrics> {
  const topic = await db.topics.findById(userId, topicId);
  if (!topic) {
    throw new AppError('NOT_FOUND', 'Topic not found');
  }
  const subjectTopics = await db.topics.listBySubject(userId, topic.subjectId);
  const metrics = await computeSubjectTopicMetrics(db, userId, topic.subjectId, subjectTopics, asOfDate);
  const topicMetrics = metrics.get(topicId);
  if (!topicMetrics) {
    throw new AppError('NOT_FOUND', 'Topic not found');
  }
  return topicMetrics;
}

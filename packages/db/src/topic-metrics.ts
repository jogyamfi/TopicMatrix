import { AppError, startOfUserDay } from '@topicmatrix/shared';
import { computeCompetencyScore, computeHealthStatus, computeRollupScore, daysBetween } from '@topicmatrix/core';
import type { Db } from './db.js';
import type { SessionScoringRow } from './repositories/study-session.js';
import type { ReviewSchedule, Topic, UserSettings } from './types.js';

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

/** The session columns metrics read — full rows or lean `SessionScoringRow`s both fit. */
export type MetricsSession = Pick<SessionScoringRow, 'topicId' | 'studiedOn' | 'questionsAttempted' | 'accuracy' | 'confidence'>;
/** The schedule columns metrics read. */
export type MetricsSchedule = Pick<ReviewSchedule, 'topicId' | 'intervalDays' | 'nextReviewOn'>;
/** The settings metrics read. */
export type MetricsSettings = Pick<
  UserSettings,
  | 'timezone'
  | 'dayStartHour'
  | 'weightAccuracy'
  | 'weightConfidence'
  | 'weightRecency'
  | 'strongThreshold'
  | 'needsReviewThreshold'
  | 'neglectThresholdDays'
>;

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

/** `own` is populated for every id in `topics` by the loop above it — this just avoids a banned `!`. */
function mustGetOwn<V>(map: Map<string, V>, topicId: string): V {
  const value = map.get(topicId);
  if (value === undefined) {
    throw new Error(`Internal error: no own-metrics entry computed for topic ${topicId}`);
  }
  return value;
}

/**
 * Own + aggregate score/health for every topic in `topics` (one subject's topics), from data the
 * caller already loaded — pure, so a bulk caller (`computeSubjectSummaries`) can load once for
 * every subject and run this per subject in memory. `sessions`/`schedules` may include other
 * topics' rows; only those for `topics` are used. Aggregates use the materialised `path` prefix
 * to find each topic's descendants (§7.3), as `topic-tree.ts` does for move/delete.
 */
export function computeTopicMetricsFromData(
  topics: readonly Topic[],
  sessions: readonly MetricsSession[],
  schedules: readonly MetricsSchedule[],
  settings: MetricsSettings,
  asOfDate: Date,
): Map<string, TopicScoreMetrics> {
  const result = new Map<string, TopicScoreMetrics>();
  if (topics.length === 0) {
    return result;
  }

  const sessionsByTopic = new Map<string, MetricsSession[]>();
  for (const session of sessions) {
    const list = sessionsByTopic.get(session.topicId);
    if (list) list.push(session);
    else sessionsByTopic.set(session.topicId, [session]);
  }
  const scheduleByTopic = new Map(schedules.map((s) => [s.topicId, s]));

  const weights = {
    accuracy: settings.weightAccuracy,
    confidence: settings.weightConfidence,
    recency: settings.weightRecency,
  };
  const rollupWindowStart = new Date(asOfDate.getTime() - ROLLUP_WINDOW_DAYS * MS_PER_DAY);
  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);

  const own = new Map<string, { score: number | null; health: string; questionsAttempted180d: number }>();

  for (const topic of topics) {
    const topicSessions = sessionsByTopic.get(topic.id) ?? [];
    const schedule = scheduleByTopic.get(topic.id) ?? null;

    const scoreResult = computeCompetencyScore({
      sessions: topicSessions,
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

/**
 * Own + aggregate metrics for every topic in `topics` (expected to be every topic in one subject,
 * per `TopicRepository.listBySubject`), loading that subject's data in two lean bulk reads.
 */
export async function computeSubjectTopicMetrics(
  db: Db,
  userId: string,
  _subjectId: string,
  topics: readonly Topic[],
  asOfDate: Date,
): Promise<Map<string, TopicScoreMetrics>> {
  if (topics.length === 0) {
    return new Map();
  }
  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }
  const topicIds = topics.map((t) => t.id);
  const [sessions, schedules] = await Promise.all([
    db.studySessions.listScoringRowsForTopics(userId, topicIds),
    db.reviewSchedules.listByTopics(userId, topicIds),
  ]);
  return computeTopicMetricsFromData(topics, sessions, schedules, settings, asOfDate);
}

/** Metrics for a single topic (its own + aggregate over its subtree). */
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

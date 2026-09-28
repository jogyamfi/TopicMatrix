import { AppError, startOfUserDay, type HealthStatus } from '@topicmatrix/shared';
import {
  computeCompetencyScore,
  computeHealthStatus,
  computeStreak,
  daysBetween,
  type ScoringWeights,
} from '@topicmatrix/core';
import type { Db } from './db.js';
import type { CompetencySnapshot } from './types.js';

const MS_PER_DAY = 86_400_000;
const ACTIVITY_CALENDAR_DAYS = 365;
/** Caps the number of sample points a retention/decay series returns, regardless of date range. */
const MAX_SAMPLE_POINTS = 400;

function groupByTopic<T extends { topicId: string }>(sessions: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const session of sessions) {
    const list = map.get(session.topicId) ?? [];
    list.push(session);
    map.set(session.topicId, list);
  }
  return map;
}

async function requireSettings(db: Db, userId: string): Promise<{
  timezone: string;
  dayStartHour: number;
  neglectThresholdDays: number;
  strongThreshold: number;
  needsReviewThreshold: number;
  weights: ScoringWeights;
}> {
  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }
  return {
    timezone: settings.timezone,
    dayStartHour: settings.dayStartHour,
    neglectThresholdDays: settings.neglectThresholdDays,
    strongThreshold: settings.strongThreshold,
    needsReviewThreshold: settings.needsReviewThreshold,
    weights: {
      accuracy: settings.weightAccuracy,
      confidence: settings.weightConfidence,
      recency: settings.weightRecency,
    },
  };
}

// ---------------------------------------------------------------------------
// GET /analytics/dashboard (FR-7.2, FR-7.3)
// ---------------------------------------------------------------------------

export interface DashboardTodaySummary {
  readonly topicsReviewed: number;
  readonly questionsAttempted: number;
  /** `null` if nothing was studied today \u2014 never 0, same "no data" convention as scoring (\u00a77.2). */
  readonly accuracy: number | null;
  readonly minutesStudied: number;
}

export interface ActivityCalendarDay {
  /** `YYYY-MM-DD`, the user-day this count belongs to. */
  readonly date: string;
  readonly sessionCount: number;
}

export interface DashboardAnalytics {
  readonly today: DashboardTodaySummary;
  readonly streak: { readonly currentStreak: number; readonly longestStreak: number };
  /** Exactly `ACTIVITY_CALENDAR_DAYS` entries, oldest first, ending on the user's current day. */
  readonly activityCalendar: ActivityCalendarDay[];
}

/**
 * `GET /analytics/dashboard` (FR-7.2, FR-7.3). `studiedOn` already encodes the correct user-day
 * bucket at write time (FR-5.9, `startOfUserDay` applied once in the session-create route), so
 * grouping sessions by `studiedOn` here needs no further timezone/day-start-hour math \u2014 only
 * `today` itself (the boundary for "today's summary" and the streak/calendar anchor) does.
 */
export async function computeDashboardAnalytics(
  db: Db,
  userId: string,
  asOfDate: Date,
): Promise<DashboardAnalytics> {
  const settings = await requireSettings(db, userId);
  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);
  const calendarStartMs = today.getTime() - (ACTIVITY_CALENDAR_DAYS - 1) * MS_PER_DAY;

  // Only the calendar's year of sessions is loaded (lean rows); the streak needs every study day
  // ever, but only the distinct dates — not the sessions (R5, NF-1).
  const [sessions, studyDays] = await Promise.all([
    db.studySessions.listScoringRowsForUser(userId, { from: new Date(calendarStartMs) }),
    db.studySessions.listStudyDaysForUser(userId),
  ]);

  const todaysSessions = sessions.filter((s) => s.studiedOn.getTime() === today.getTime());
  const questionsAttempted = todaysSessions.reduce((sum, s) => sum + s.questionsAttempted, 0);
  const questionsCorrect = todaysSessions.reduce((sum, s) => sum + s.questionsCorrect, 0);
  const minutesStudied = todaysSessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);

  const streak = computeStreak(studyDays, today);

  const countByDayMs = new Map<number, number>();
  for (const session of sessions) {
    const t = session.studiedOn.getTime();
    if (t >= calendarStartMs && t <= today.getTime()) {
      countByDayMs.set(t, (countByDayMs.get(t) ?? 0) + 1);
    }
  }
  const activityCalendar: ActivityCalendarDay[] = [];
  for (let t = calendarStartMs; t <= today.getTime(); t += MS_PER_DAY) {
    activityCalendar.push({
      date: new Date(t).toISOString().slice(0, 10),
      sessionCount: countByDayMs.get(t) ?? 0,
    });
  }

  return {
    today: {
      topicsReviewed: new Set(todaysSessions.map((s) => s.topicId)).size,
      questionsAttempted,
      accuracy: questionsAttempted > 0 ? questionsCorrect / questionsAttempted : null,
      minutesStudied,
    },
    streak,
    activityCalendar,
  };
}

// ---------------------------------------------------------------------------
// GET /analytics/mastery (FR-7.4)
// ---------------------------------------------------------------------------

export interface MasteryTopic {
  readonly topicId: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly score: number | null;
  readonly isProvisional: boolean;
}

/** `GET /analytics/mastery` (FR-7.4): own competency score per topic in one subject. */
export async function computeMastery(
  db: Db,
  userId: string,
  subjectId: string,
  asOfDate: Date,
): Promise<MasteryTopic[]> {
  const topics = await db.topics.listBySubject(userId, subjectId);
  if (topics.length === 0) {
    return [];
  }
  const settings = await requireSettings(db, userId);
  const [sessions, schedules] = await Promise.all([
    db.studySessions.listBySubject(userId, subjectId),
    db.reviewSchedules.listBySubject(userId, subjectId),
  ]);
  const sessionsByTopic = groupByTopic(sessions);
  const scheduleByTopic = new Map(schedules.map((s) => [s.topicId, s]));

  return topics.map((topic) => {
    const schedule = scheduleByTopic.get(topic.id) ?? null;
    const result = computeCompetencyScore({
      sessions: (sessionsByTopic.get(topic.id) ?? []).map((s) => ({
        studiedOn: s.studiedOn,
        questionsAttempted: s.questionsAttempted,
        accuracy: s.accuracy,
        confidence: s.confidence,
      })),
      asOfDate,
      currentIntervalDays: schedule?.intervalDays ?? null,
      weights: settings.weights,
    });
    return {
      topicId: topic.id,
      name: topic.name,
      parentId: topic.parentId,
      depth: topic.depth,
      score: result.score,
      isProvisional: result.isProvisional,
    };
  });
}

// ---------------------------------------------------------------------------
// GET /analytics/heatmap (FR-7.5)
// ---------------------------------------------------------------------------

export type HeatmapStatus = 'neverStarted' | 'neglected' | 'scored';

export interface HeatmapTopic {
  readonly topicId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly depth: number;
  readonly score: number | null;
  readonly status: HeatmapStatus;
}

/**
 * `GET /analytics/heatmap` (FR-7.5): the topic tree keyed on score, with *neglected* (no session
 * in >= `neglectThresholdDays`, regardless of how high the score still reads) and *never
 * started* called out as distinct statuses from a merely low score \u2014 both would otherwise
 * collapse into the same "at risk" health-status bucket `topic-metrics.ts` uses for the tree/
 * dashboard views, which loses exactly the distinction this chart exists to show.
 */
export async function computeHeatmap(
  db: Db,
  userId: string,
  subjectId: string,
  asOfDate: Date,
): Promise<HeatmapTopic[]> {
  const topics = await db.topics.listBySubject(userId, subjectId);
  if (topics.length === 0) {
    return [];
  }
  const settings = await requireSettings(db, userId);
  const [sessions, schedules] = await Promise.all([
    db.studySessions.listBySubject(userId, subjectId),
    db.reviewSchedules.listBySubject(userId, subjectId),
  ]);
  const sessionsByTopic = groupByTopic(sessions);
  const scheduleByTopic = new Map(schedules.map((s) => [s.topicId, s]));

  return topics.map((topic) => {
    const topicSessions = sessionsByTopic.get(topic.id) ?? [];
    const schedule = scheduleByTopic.get(topic.id) ?? null;
    const result = computeCompetencyScore({
      sessions: topicSessions.map((s) => ({
        studiedOn: s.studiedOn,
        questionsAttempted: s.questionsAttempted,
        accuracy: s.accuracy,
        confidence: s.confidence,
      })),
      asOfDate,
      currentIntervalDays: schedule?.intervalDays ?? null,
      weights: settings.weights,
    });

    let lastSessionOn: Date | null = null;
    for (const session of topicSessions) {
      if (!lastSessionOn || session.studiedOn > lastSessionOn) {
        lastSessionOn = session.studiedOn;
      }
    }
    const daysSinceLastSession = lastSessionOn ? daysBetween(lastSessionOn, asOfDate) : null;

    const status: HeatmapStatus =
      result.score === null
        ? 'neverStarted'
        : daysSinceLastSession !== null && daysSinceLastSession >= settings.neglectThresholdDays
          ? 'neglected'
          : 'scored';

    return {
      topicId: topic.id,
      parentId: topic.parentId,
      name: topic.name,
      depth: topic.depth,
      score: result.score,
      status,
    };
  });
}

// ---------------------------------------------------------------------------
// GET /analytics/health (FR-7.6, Topic Health View)
// ---------------------------------------------------------------------------

export type ReviewTrend = 'up' | 'down' | 'flat' | null;

export interface TopicHealthRow {
  readonly topicId: string;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly name: string;
  readonly score: number | null;
  readonly healthStatus: HealthStatus;
  readonly lastReviewedOn: Date | null;
  readonly nextReviewOn: Date | null;
  /** Overall accuracy across every logged session (unweighted), as a percentage 0..100. */
  readonly accuracyPct: number | null;
  /** `(avgConfidence - 1) / 4`, as a percentage 0..100 (FR-7.6's literal formula). */
  readonly confidencePct: number | null;
  /** From the difference between the topic's last two `CompetencySnapshot`s; `null` with < 2. */
  readonly reviewTrend: ReviewTrend;
}

/**
 * `GET /analytics/health` (FR-7.6): every topic the user owns, across every (non-archived)
 * subject \u2014 the same cross-subject bulk-read shape `review-queue.ts`'s `computeEligibleTopicItems`
 * uses, per the P8 handover note, but WITHOUT that function's "has an active schedule" filter:
 * the Health View must also list never-studied topics (`score: null`, `healthStatus:
 * 'notStarted'`), which have no `ReviewSchedule` row at all.
 */
export async function computeTopicHealthView(
  db: Db,
  userId: string,
  asOfDate: Date,
  opts?: { subjectId?: string },
): Promise<TopicHealthRow[]> {
  const settings = await requireSettings(db, userId);
  // Lean session rows, and only each topic's latest two snapshot scores (all the ▲▼ trend needs)
  // rather than every snapshot ever (R5, NF-1).
  const [subjects, allTopics, allSessions, allSchedules, latestScores] = await Promise.all([
    db.subjects.list(userId),
    db.topics.listAllForUser(userId),
    db.studySessions.listScoringRowsForUser(userId),
    db.reviewSchedules.listAllForUser(userId),
    db.competencySnapshots.listLatestTwoScoresForUser(userId),
  ]);

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const topics = allTopics.filter((t) => {
    const subject = subjectById.get(t.subjectId);
    if (!subject || subject.isArchived) return false;
    return opts?.subjectId ? t.subjectId === opts.subjectId : true;
  });
  if (topics.length === 0) {
    return [];
  }

  const sessionsByTopic = groupByTopic(allSessions);
  const scheduleByTopic = new Map(allSchedules.map((s) => [s.topicId, s]));

  return topics.map((topic) => {
    const subject = subjectById.get(topic.subjectId);
    if (!subject) {
      throw new AppError('INTERNAL_ERROR', `Missing subject for topic ${topic.id}`);
    }
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
      weights: settings.weights,
    });

    let lastSessionOn: Date | null = null;
    let totalAttempted = 0;
    let totalCorrect = 0;
    let totalConfidence = 0;
    for (const session of topicSessions) {
      if (!lastSessionOn || session.studiedOn > lastSessionOn) {
        lastSessionOn = session.studiedOn;
      }
      totalAttempted += session.questionsAttempted;
      totalCorrect += session.questionsCorrect;
      totalConfidence += session.confidence;
    }

    const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);
    const overdueDays = schedule?.nextReviewOn
      ? Math.max(0, Math.round(daysBetween(schedule.nextReviewOn, today)))
      : 0;
    const healthStatus = computeHealthStatus({
      score: scoreResult.score,
      overdueDays,
      daysSinceLastSession: lastSessionOn ? daysBetween(lastSessionOn, asOfDate) : null,
      strongThreshold: settings.strongThreshold,
      needsReviewThreshold: settings.needsReviewThreshold,
      neglectThresholdDays: settings.neglectThresholdDays,
    });

    const [latestScore, previousScore] = latestScores.get(topic.id) ?? [undefined, undefined];
    const reviewTrend: ReviewTrend =
      latestScore !== undefined && previousScore !== undefined
        ? latestScore > previousScore
          ? 'up'
          : latestScore < previousScore
            ? 'down'
            : 'flat'
        : null;

    return {
      topicId: topic.id,
      subjectId: topic.subjectId,
      subjectName: subject.name,
      name: topic.name,
      score: scoreResult.score,
      healthStatus,
      lastReviewedOn: schedule?.lastReviewedOn ?? null,
      nextReviewOn: schedule?.nextReviewOn ?? null,
      accuracyPct: totalAttempted > 0 ? (totalCorrect / totalAttempted) * 100 : null,
      confidencePct:
        topicSessions.length > 0
          ? ((totalConfidence / topicSessions.length - 1) / 4) * 100
          : null,
      reviewTrend,
    };
  });
}

// ---------------------------------------------------------------------------
// GET /analytics/retention (FR-7.7)
// ---------------------------------------------------------------------------

export interface RetentionEventPoint {
  readonly date: string;
  readonly score: number;
}

export interface RetentionProjectionPoint {
  readonly date: string;
  readonly score: number;
}

export interface RetentionSeries {
  /** Actual `CompetencySnapshot` points \u2014 "review events marked" (FR-7.7). */
  readonly events: RetentionEventPoint[];
  /** The modelled decay between/after review events \u2014 rendered as a dashed projection. */
  readonly projection: RetentionProjectionPoint[];
}

/**
 * Projects the decay of one snapshot's score forward in time, holding its accuracy/confidence
 * components constant (no new sessions occur between review events by definition) and letting
 * only the recency term decay \u2014 the same `exp(-\u0394t / interval)` shape `computeCompetencyScore`
 * uses (\u00a77.1). `intervalApprox` (the gap to the NEXT review, or to the series end if there isn't
 * one yet) stands in for the topic's actual scheduling interval at that point in history, which
 * isn't reconstructable from stored data alone \u2014 a documented approximation, not the exact
 * historical interval.
 */
function projectSnapshotDecay(
  snapshot: CompetencySnapshot,
  weights: ScoringWeights,
  intervalApprox: number,
  sampleDates: readonly Date[],
): RetentionProjectionPoint[] {
  return sampleDates.map((date) => {
    const deltaT = Math.max(0, daysBetween(snapshot.capturedOn, date));
    const recency = Math.exp(-deltaT / Math.max(intervalApprox, 1));
    const raw =
      100 *
      (weights.accuracy * snapshot.accuracyComponent +
        weights.confidence * snapshot.confidenceComponent +
        weights.recency * recency);
    return { date: date.toISOString().slice(0, 10), score: Math.min(100, Math.max(0, raw)) };
  });
}

function buildSampleDates(from: Date, to: Date): Date[] {
  const totalDays = Math.max(1, Math.round(daysBetween(from, to)));
  const step = Math.max(1, Math.ceil(totalDays / MAX_SAMPLE_POINTS));
  const dates: Date[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += step * MS_PER_DAY) {
    dates.push(new Date(t));
  }
  dates.push(to);
  return dates;
}

/**
 * `GET /analytics/retention` (FR-7.7): for a single topic, or (a documented approximation, see
 * `projectSnapshotDecay`) the unweighted mean across every topic in a subject.
 */
export async function computeRetentionSeries(
  db: Db,
  userId: string,
  target: { topicId: string } | { subjectId: string },
  range: { from?: Date; to?: Date },
  asOfDate: Date,
): Promise<RetentionSeries> {
  const settings = await requireSettings(db, userId);
  const topicIds =
    'topicId' in target
      ? [target.topicId]
      : (await db.topics.listBySubject(userId, target.subjectId)).map((t) => t.id);
  if (topicIds.length === 0) {
    return { events: [], projection: [] };
  }

  // One query for every topic's snapshots (was one per topic — 100 queries for a subject), then
  // regrouped per topic (R5, NF-1).
  const snapshotsForTopics =
    'topicId' in target
      ? await db.competencySnapshots.listByTopic(userId, target.topicId)
      : await db.competencySnapshots.listByTopics(userId, topicIds);
  const snapshotsByTopic = groupByTopic(snapshotsForTopics);
  const perTopicSnapshots = topicIds.map((topicId) => snapshotsByTopic.get(topicId) ?? []);
  const allSnapshots = perTopicSnapshots.flat().sort((a, b) => a.capturedOn.getTime() - b.capturedOn.getTime());
  if (allSnapshots.length === 0) {
    return { events: [], projection: [] };
  }

  const earliest = allSnapshots[0]?.capturedOn ?? asOfDate;
  const spanStart = range.from ?? earliest;
  const spanEnd = range.to ?? asOfDate;
  const sampleDates = buildSampleDates(spanStart, spanEnd);

  const projectionsByTopic = perTopicSnapshots.map((snapshots) => {
    const sorted = [...snapshots].sort((a, b) => a.capturedOn.getTime() - b.capturedOn.getTime());
    const byDate = new Map<string, number>();
    for (let i = 0; i < sorted.length; i += 1) {
      const snapshot = sorted[i];
      if (!snapshot) continue;
      const next = sorted[i + 1];
      const intervalApprox = daysBetween(snapshot.capturedOn, next?.capturedOn ?? spanEnd);
      const relevantSamples = sampleDates.filter(
        (d) => d.getTime() >= snapshot.capturedOn.getTime() && (!next || d.getTime() < next.capturedOn.getTime()),
      );
      for (const point of projectSnapshotDecay(snapshot, settings.weights, intervalApprox, relevantSamples)) {
        byDate.set(point.date, point.score);
      }
    }
    return byDate;
  });

  const projection: RetentionProjectionPoint[] = sampleDates.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const values = projectionsByTopic.map((m) => m.get(key)).filter((v): v is number => v !== undefined);
    const score = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    return { date: key, score };
  });

  const events: RetentionEventPoint[] = allSnapshots
    .filter((s) => s.capturedOn.getTime() >= spanStart.getTime() && s.capturedOn.getTime() <= spanEnd.getTime())
    .map((s) => ({ date: s.capturedOn.toISOString().slice(0, 10), score: s.score }));

  return { events, projection };
}

// ---------------------------------------------------------------------------
// GET /analytics/accuracy-confidence (FR-7.8)
// ---------------------------------------------------------------------------

export interface AccuracyConfidencePoint {
  readonly date: string;
  readonly accuracy: number;
  /** Raw 1..5 confidence, as logged. */
  readonly confidence: number;
  /** `(confidence - 1) / 4`, normalised to the same 0..1 scale as `accuracy` for the shared axis. */
  readonly confidenceNormalised: number;
}

/** `GET /analytics/accuracy-confidence` (FR-7.8): one point per session, oldest first. */
export async function computeAccuracyConfidenceSeries(
  db: Db,
  userId: string,
  target: { topicId: string } | { subjectId: string },
  range: { from?: Date; to?: Date },
): Promise<AccuracyConfidencePoint[]> {
  const sessions =
    'topicId' in target
      ? await db.studySessions.listByTopic(userId, target.topicId)
      : await db.studySessions.listBySubject(userId, target.subjectId);

  return sessions
    .filter(
      (s) =>
        (!range.from || s.studiedOn.getTime() >= range.from.getTime()) &&
        (!range.to || s.studiedOn.getTime() <= range.to.getTime()),
    )
    .slice()
    .sort((a, b) => a.studiedOn.getTime() - b.studiedOn.getTime())
    .map((s) => ({
      date: s.studiedOn.toISOString().slice(0, 10),
      accuracy: s.accuracy,
      confidence: s.confidence,
      confidenceNormalised: (s.confidence - 1) / 4,
    }));
}

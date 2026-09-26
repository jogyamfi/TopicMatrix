import { AppError, startOfUserDay } from '@topicmatrix/shared';
import { computeCompetencyScore, computeHealthStatus, daysBetween } from '@topicmatrix/core';
import type { Db } from './db.js';
import type { StudySession } from './types.js';

const MS_PER_DAY = 86_400_000;
const NEXT_7_DAYS_MS = 7 * MS_PER_DAY;
/** No history/duration data yet to estimate from (FR-6.4's target-minutes cap) \u2014 a rough default. */
const DEFAULT_MINUTES_PER_ITEM = 5;

/**
 * Review queue / launcher item (delivery-plan.md P8, FR-6.*, FR-7.1). One entry per topic that
 * currently has a `ReviewSchedule` row and isn't suspended or archived. A schedule is usually
 * created lazily on first session (FR-5.1), but FR-5.6/FR-5.10 also let a next-review date or
 * suspended flag be set directly on a never-studied topic \u2014 such a topic can still appear here,
 * with a `null` score (see below). A topic with no schedule at all (never studied, never
 * overridden) has nothing to review yet and never appears here.
 */
export interface ReviewQueueItem {
  readonly topicId: string;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly name: string;
  readonly notes: string | null;
  /** Own competency score, as of the query time. `null` if the topic has never been studied \u2014 a
   * schedule can exist with zero sessions (FR-5.6 lets a next-review date be set directly). */
  readonly score: number | null;
  readonly healthStatus: string;
  readonly lastReviewedOn: Date | null;
  readonly nextReviewOn: Date | null;
  /** Days overdue, clamped to >= 0 (FR-7.1's primary sort key). */
  readonly overdueDays: number;
  /** Compares the two most recent sessions' accuracy; `null` with fewer than two sessions. */
  readonly accuracyTrend: 'up' | 'down' | 'flat' | null;
  /** Materialised path (topic-tree.ts convention) \u2014 used to filter a topic + its descendants. */
  readonly path: string;
}

export interface ReviewQueueBuckets {
  readonly overdue: ReviewQueueItem[];
  readonly dueToday: ReviewQueueItem[];
  readonly dueNext7Days: ReviewQueueItem[];
  /**
   * Never-studied topics (no schedule yet), oldest first, capped at `NOT_STARTED_LIMIT`. Not *due*
   * (SRS Q2: a topic with nothing to review never enters the due buckets) but surfaced separately
   * so a new learner's queue points at where to start instead of sitting empty.
   */
  readonly notStarted: ReviewQueueItem[];
  /** How many never-studied topics exist in total (`notStarted` shows at most the first few). */
  readonly notStartedTotal: number;
  /** The earliest upcoming review (after today), for "nothing due — next review on …". */
  readonly nextReviewOn: Date | null;
}

/** How many never-studied topics the queue lists. */
export const NOT_STARTED_LIMIT = 10;

interface EligibleTopics {
  /** Scheduled, not suspended, not archived — the due-bucket and launcher candidates. */
  readonly items: ReviewQueueItem[];
  /** Not suspended, not archived, never scheduled — oldest first. */
  readonly unscheduled: ReviewQueueItem[];
}

/**
 * One bulk read of every eligible topic the user owns, with score/health/schedule/accuracy-trend
 * computed in a single pass \u2014 the cross-subject piece the P7 handover note flagged as needed for
 * a real review queue (topic-metrics.ts's per-subject loop is the model this follows, minus the
 * aggregate roll-up, which the queue has no use for). Shared by `computeReviewQueue` and
 * `buildReviewSession` so both start from exactly the same eligibility/scoring rules.
 */
async function computeEligibleTopicItems(
  db: Db,
  userId: string,
  asOfDate: Date,
): Promise<EligibleTopics> {
  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }

  const [subjects, topics, sessions, schedules] = await Promise.all([
    db.subjects.list(userId),
    db.topics.listAllForUser(userId),
    db.studySessions.listAllForUser(userId),
    db.reviewSchedules.listAllForUser(userId),
  ]);

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const sessionsByTopic = new Map<string, StudySession[]>();
  for (const session of sessions) {
    const list = sessionsByTopic.get(session.topicId) ?? [];
    list.push(session);
    sessionsByTopic.set(session.topicId, list);
  }
  const scheduleByTopic = new Map(schedules.map((s) => [s.topicId, s]));
  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);
  const weights = {
    accuracy: settings.weightAccuracy,
    confidence: settings.weightConfidence,
    recency: settings.weightRecency,
  };

  const items: ReviewQueueItem[] = [];
  const unscheduled: { item: ReviewQueueItem; createdAt: Date }[] = [];
  for (const topic of topics) {
    const subject = subjectById.get(topic.subjectId);
    // Suspended topics and archived subjects are excluded (FR-5.10, FR-7.1).
    if (!subject || subject.isArchived || topic.isSuspended) {
      continue;
    }
    const schedule = scheduleByTopic.get(topic.id) ?? null;
    if (!schedule) {
      unscheduled.push({
        createdAt: topic.createdAt,
        item: {
          topicId: topic.id,
          subjectId: topic.subjectId,
          subjectName: subject.name,
          name: topic.name,
          notes: topic.notes,
          score: null,
          healthStatus: 'notStarted',
          lastReviewedOn: null,
          nextReviewOn: null,
          overdueDays: 0,
          accuracyTrend: null,
          path: topic.path,
        },
      });
      continue;
    }

    const topicSessions = (sessionsByTopic.get(topic.id) ?? [])
      .slice()
      .sort((a, b) => b.studiedOn.getTime() - a.studiedOn.getTime());

    const scoreResult = computeCompetencyScore({
      sessions: topicSessions.map((s) => ({
        studiedOn: s.studiedOn,
        questionsAttempted: s.questionsAttempted,
        accuracy: s.accuracy,
        confidence: s.confidence,
      })),
      asOfDate,
      currentIntervalDays: schedule.intervalDays,
      weights,
    });

    const [latestSession, previousSession] = topicSessions;
    const overdueDays = schedule.nextReviewOn
      ? Math.max(0, Math.round(daysBetween(schedule.nextReviewOn, today)))
      : 0;
    const health = computeHealthStatus({
      score: scoreResult.score,
      overdueDays,
      daysSinceLastSession: latestSession ? daysBetween(latestSession.studiedOn, asOfDate) : null,
      strongThreshold: settings.strongThreshold,
      needsReviewThreshold: settings.needsReviewThreshold,
      neglectThresholdDays: settings.neglectThresholdDays,
    });

    items.push({
      topicId: topic.id,
      subjectId: topic.subjectId,
      subjectName: subject.name,
      name: topic.name,
      notes: topic.notes,
      score: scoreResult.score,
      healthStatus: health,
      lastReviewedOn: schedule.lastReviewedOn,
      nextReviewOn: schedule.nextReviewOn,
      overdueDays,
      accuracyTrend:
        latestSession && previousSession
          ? latestSession.accuracy > previousSession.accuracy
            ? 'up'
            : latestSession.accuracy < previousSession.accuracy
              ? 'down'
              : 'flat'
          : null,
      path: topic.path,
    });
  }
  unscheduled.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.item.topicId.localeCompare(b.item.topicId),
  );
  return { items, unscheduled: unscheduled.map((u) => u.item) };
}

/** FR-7.1's primary sort: overdue days descending, then competency score ascending (nulls last). */
function sortByOverdueDescScoreAsc(items: readonly ReviewQueueItem[]): ReviewQueueItem[] {
  return [...items].sort((a, b) => {
    if (b.overdueDays !== a.overdueDays) {
      return b.overdueDays - a.overdueDays;
    }
    return (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY);
  });
}

/** `GET /review/queue` (FR-7.1): Overdue / Due today / Due in the next 7 days. */
export async function computeReviewQueue(
  db: Db,
  userId: string,
  asOfDate: Date,
): Promise<ReviewQueueBuckets> {
  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }
  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);
  const in7Days = new Date(today.getTime() + NEXT_7_DAYS_MS);

  const eligible = await computeEligibleTopicItems(db, userId, asOfDate);
  const items = eligible.items.filter(
    (i): i is ReviewQueueItem & { nextReviewOn: Date } => i.nextReviewOn !== null,
  );

  const overdue = items.filter((i) => i.nextReviewOn.getTime() < today.getTime());
  const dueToday = items.filter((i) => i.nextReviewOn.getTime() === today.getTime());
  const dueNext7Days = items.filter(
    (i) => i.nextReviewOn.getTime() > today.getTime() && i.nextReviewOn.getTime() <= in7Days.getTime(),
  );

  return {
    overdue: sortByOverdueDescScoreAsc(overdue),
    dueToday: sortByOverdueDescScoreAsc(dueToday),
    dueNext7Days: sortByOverdueDescScoreAsc(dueNext7Days),
    notStarted: eligible.unscheduled.slice(0, NOT_STARTED_LIMIT),
    notStartedTotal: eligible.unscheduled.length,
    nextReviewOn: items.reduce<Date | null>(
      (earliest, i) =>
        i.nextReviewOn.getTime() > today.getTime() && (!earliest || i.nextReviewOn < earliest) ? i.nextReviewOn : earliest,
      null,
    ),
  };
}

export type ReviewSessionMode =
  | { readonly kind: 'subject'; readonly subjectId: string }
  | { readonly kind: 'topicSubtree'; readonly topicId: string }
  | { readonly kind: 'dueToday' }
  | { readonly kind: 'weakest' };

export interface ReviewSessionFilters {
  readonly tagId?: string;
  readonly healthStatus?: string;
  /** Topic not reviewed in at least this many days; a never-reviewed topic always qualifies. */
  readonly notReviewedInDays?: number;
  readonly minScore?: number;
  readonly maxScore?: number;
}

export interface ReviewSessionCaps {
  readonly maxItems?: number;
  readonly targetMinutes?: number;
}

/** Average of the user's logged `durationMinutes` (FR-6.4's target-minutes cap estimator). */
async function estimateMinutesPerItem(db: Db, userId: string): Promise<number> {
  const sessions = await db.studySessions.listAllForUser(userId);
  const durations = sessions
    .map((s) => s.durationMinutes)
    .filter((d): d is number => d !== null && d > 0);
  if (durations.length === 0) {
    return DEFAULT_MINUTES_PER_ITEM;
  }
  return durations.reduce((sum, d) => sum + d, 0) / durations.length;
}

/**
 * `POST /review/start` (FR-6.1, FR-6.2, FR-6.4): builds an ordered, capped list of topics for the
 * launcher. `mode` selects the primary scope; `filters` narrow it further; `caps` trim the result.
 */
export async function buildReviewSession(
  db: Db,
  userId: string,
  mode: ReviewSessionMode,
  filters: ReviewSessionFilters,
  caps: ReviewSessionCaps,
  asOfDate: Date,
): Promise<ReviewQueueItem[]> {
  const settings = await db.userSettings.find(userId);
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }
  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);

  let items = (await computeEligibleTopicItems(db, userId, asOfDate)).items;

  if (mode.kind === 'subject') {
    items = items.filter((i) => i.subjectId === mode.subjectId);
  } else if (mode.kind === 'topicSubtree') {
    const topic = await db.topics.findById(userId, mode.topicId);
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    // Materialised path convention (topic-tree.ts): a topic's own path already ends with its own
    // id, so `startsWith` includes the topic itself as well as every descendant.
    items = items.filter((i) => i.path.startsWith(topic.path));
  } else if (mode.kind === 'dueToday') {
    items = items.filter((i) => i.nextReviewOn !== null && i.nextReviewOn.getTime() <= today.getTime());
  }

  if (filters.tagId) {
    const tagged = await db.tags.topicsForTag(userId, filters.tagId);
    const taggedIds = new Set(tagged.map((t) => t.id));
    items = items.filter((i) => taggedIds.has(i.topicId));
  }
  if (filters.healthStatus) {
    items = items.filter((i) => i.healthStatus === filters.healthStatus);
  }
  if (filters.notReviewedInDays !== undefined) {
    const threshold = filters.notReviewedInDays;
    items = items.filter(
      (i) => i.lastReviewedOn === null || daysBetween(i.lastReviewedOn, asOfDate) >= threshold,
    );
  }
  if (filters.minScore !== undefined) {
    const min = filters.minScore;
    items = items.filter((i) => i.score !== null && i.score >= min);
  }
  if (filters.maxScore !== undefined) {
    const max = filters.maxScore;
    items = items.filter((i) => i.score !== null && i.score <= max);
  }

  items =
    mode.kind === 'weakest'
      ? [...items].sort((a, b) => (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY))
      : sortByOverdueDescScoreAsc(items);

  if (caps.maxItems !== undefined) {
    items = items.slice(0, caps.maxItems);
  }
  if (caps.targetMinutes !== undefined) {
    const minutesPerItem = await estimateMinutesPerItem(db, userId);
    const target = caps.targetMinutes;
    const capped: ReviewQueueItem[] = [];
    let total = 0;
    for (const item of items) {
      // Always include at least one item, even if it alone exceeds the target on its own.
      if (capped.length > 0 && total + minutesPerItem > target) {
        break;
      }
      capped.push(item);
      total += minutesPerItem;
    }
    items = capped;
  }

  return items;
}

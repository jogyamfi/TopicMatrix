import {
  AppError,
  addDays,
  parseManualIntervals,
  startOfUserDay,
  type Algorithm,
} from '@topicmatrix/shared';
import {
  computeCompetencyScore,
  getScheduler,
  resolveSessionGrade,
  roundScoreForStorage,
  type Grade,
  type SchedulerOutput,
} from '@topicmatrix/core';
import type { Db } from './db.js';
import type { ReviewSchedule, StudySession, TransactionClient } from './types.js';

/**
 * Topic override -> subject default -> user default (FR-5.3) — the one resolver every caller
 * uses, so a topic's effective algorithm is never computed two different ways.
 */
export function resolveAlgorithm(
  topicAlgorithmOverride: string | null,
  subjectDefaultAlgorithm: string | null,
  userDefaultAlgorithm: string,
): Algorithm {
  return (topicAlgorithmOverride ?? subjectDefaultAlgorithm ?? userDefaultAlgorithm) as Algorithm;
}

export interface RecalculationResult {
  schedule: ReviewSchedule | null;
  algorithm: Algorithm;
  /** Whether `nextReviewOn` differs from what it was before this recalculation (FR-5.7). */
  datesChanged: boolean;
  /** `Topic.isSuspended` — the one suspend flag (FR-5.10), reported alongside the schedule. */
  isSuspended: boolean;
}

/** Oldest first, deterministic within a day (creation order, then id). */
function chronological(sessions: readonly StudySession[]): StudySession[] {
  return [...sessions].sort(
    (a, b) =>
      a.studiedOn.getTime() - b.studiedOn.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Recomputes a topic's `ReviewSchedule` AND its whole `CompetencySnapshot` series from its FULL
 * session history (§8.6), inside the caller's transaction — every `StudySession` create/update/
 * delete and every change to the topic's effective algorithm or manual ladder calls this rather
 * than patching incrementally (FR-4.3, FR-4.4, FR-4.7, FR-5.7, FR-7.10).
 *
 * Snapshots are DERIVED, like the schedule: one per distinct day studied, `capturedOn` = that day,
 * scored as of that day from the sessions up to and including it. So a back-dated session lands
 * on the day it was studied (not the day it was logged), and editing or deleting a session
 * rewrites history exactly as a fresh replay would — no duplicate same-day snapshots from edits,
 * which would otherwise corrupt the ▲▼ review trend (the last two snapshots).
 */
export async function recalculateTopicScheduleInTx(
  tx: TransactionClient,
  userId: string,
  topicId: string,
): Promise<RecalculationResult> {
  const topic = await tx.topic.findFirst({
    where: { id: topicId, subject: { userId } },
    include: { subject: true },
  });
  if (!topic) {
    throw new AppError('NOT_FOUND', 'Topic not found');
  }
  const settings = await tx.userSettings.findUnique({ where: { userId } });
  if (!settings) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }

  const algorithm = resolveAlgorithm(
    topic.algorithmOverride,
    topic.subject.defaultAlgorithm,
    settings.defaultAlgorithm,
  );
  const scheduler = getScheduler(algorithm);
  const schedulerSettings = { manualIntervals: parseManualIntervals(settings.manualIntervalsJson) };
  const weights = {
    accuracy: settings.weightAccuracy,
    confidence: settings.weightConfidence,
    recency: settings.weightRecency,
  };

  const sessions = chronological(await tx.studySession.findMany({ where: { topicId } }));

  // One pass: fold each session through the scheduler (the replay, §8.6), and at the end of each
  // study day record that day's snapshot, using the interval in effect after that day's reviews.
  let output: SchedulerOutput | null = null;
  const snapshots: {
    topicId: string;
    capturedOn: Date;
    score: number;
    accuracyComponent: number;
    confidenceComponent: number;
    recencyComponent: number;
    triggeredBySessionId: string;
  }[] = [];
  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i] as StudySession;
    output = scheduler.schedule({
      grade: resolveSessionGrade({
        accuracy: session.accuracy,
        confidence: session.confidence,
        gradeUsed: (session.gradeUsed as Grade | null) ?? null,
      }),
      reviewedOn: session.studiedOn,
      state: output?.state ?? null,
      settings: schedulerSettings,
    });

    const next = sessions[i + 1];
    const isLastOfDay = !next || next.studiedOn.getTime() !== session.studiedOn.getTime();
    if (!isLastOfDay) {
      continue;
    }
    const scoreResult = computeCompetencyScore({
      sessions: sessions.slice(0, i + 1),
      asOfDate: session.studiedOn,
      currentIntervalDays: output.intervalDays,
      weights,
    });
    if (scoreResult.score !== null) {
      snapshots.push({
        topicId,
        capturedOn: session.studiedOn,
        score: roundScoreForStorage(scoreResult.score),
        accuracyComponent: scoreResult.accuracyComponent ?? 0,
        confidenceComponent: scoreResult.confidenceComponent ?? 0,
        recencyComponent: scoreResult.recencyComponent ?? 0,
        triggeredBySessionId: session.id,
      });
    }
  }

  const existing = await tx.reviewSchedule.findUnique({ where: { topicId } });
  const previousNextReviewOn = existing?.nextReviewOn?.getTime() ?? null;

  let schedule: ReviewSchedule | null;
  if (!output) {
    if (existing && existing.lastReviewedOn === null) {
      // Never derived from sessions: a next-review date the user set directly on a never-studied
      // topic (FR-5.6). Keep it; only the algorithm it will eventually be scheduled with changes.
      schedule =
        existing.algorithm === algorithm
          ? existing
          : await tx.reviewSchedule.update({ where: { topicId }, data: { algorithm } });
    } else {
      // The last session was just deleted — drop the now-stale scheduling state rather than
      // leaving the old replay's dates behind.
      if (existing) {
        await tx.reviewSchedule.delete({ where: { topicId } });
      }
      schedule = null;
    }
  } else {
    const scheduleData = {
      algorithm,
      lastReviewedOn: output.state.lastReviewedOn,
      nextReviewOn: output.nextReviewOn,
      intervalDays: output.intervalDays,
      repetitions: output.state.repetitions,
      lapses: output.state.lapses,
      easeFactor: output.state.easeFactor,
      stability: output.state.stability,
      difficulty: output.state.difficulty,
      manualLadderIndex: output.state.manualLadderIndex,
    };
    schedule = await tx.reviewSchedule.upsert({
      where: { topicId },
      create: { topicId, ...scheduleData },
      update: scheduleData,
    });
  }

  await tx.competencySnapshot.deleteMany({ where: { topicId } });
  if (snapshots.length > 0) {
    await tx.competencySnapshot.createMany({ data: snapshots });
  }

  return {
    schedule,
    algorithm,
    datesChanged: previousNextReviewOn !== (schedule?.nextReviewOn?.getTime() ?? null),
    isSuspended: topic.isSuspended,
  };
}

/** `recalculateTopicScheduleInTx` in its own `UnitOfWork`. */
export function recalculateTopicSchedule(
  db: Db,
  userId: string,
  topicId: string,
): Promise<RecalculationResult> {
  return db.unitOfWork.run((tx) => recalculateTopicScheduleInTx(tx, userId, topicId));
}

/**
 * Recalculates every listed topic that has a schedule (a topic with none has nothing to move),
 * returning how many next-review dates actually changed — used when a change upstream of the
 * topic (subject/user default algorithm, the manual ladder, a move to another subject) changes
 * which algorithm or ladder its schedule is derived from (FR-5.7).
 */
export async function recalculateTopicSchedulesInTx(
  tx: TransactionClient,
  userId: string,
  topicIds: readonly string[],
): Promise<number> {
  if (topicIds.length === 0) {
    return 0;
  }
  const scheduled = await tx.reviewSchedule.findMany({
    where: { topicId: { in: [...topicIds] }, topic: { subject: { userId } } },
    select: { topicId: true },
  });
  let changed = 0;
  for (const { topicId } of scheduled) {
    const result = await recalculateTopicScheduleInTx(tx, userId, topicId);
    if (result.datesChanged) {
      changed += 1;
    }
  }
  return changed;
}

export type ScheduleOverride =
  | { kind: 'setNextReviewOn'; nextReviewOn: Date }
  | { kind: 'snooze'; days: number }
  | { kind: 'suspend'; suspended: boolean };

export interface ScheduleOverrideResult {
  /** `null` only when suspending a topic that has never had a schedule. */
  schedule: ReviewSchedule | null;
  isSuspended: boolean;
}

/**
 * User-driven schedule overrides (FR-5.6, FR-5.10) — independent of session history, so applied
 * directly rather than through a replay. Suspending sets `Topic.isSuspended` (the one suspend
 * flag, which works whether or not a schedule exists). A next-review date or snooze on a
 * never-studied topic creates its schedule row (with the resolved algorithm).
 */
export async function applyScheduleOverride(
  db: Db,
  userId: string,
  topicId: string,
  override: ScheduleOverride,
  asOfDate: Date,
): Promise<ScheduleOverrideResult> {
  return db.unitOfWork.run(async (tx) => {
    const topic = await tx.topic.findFirst({
      where: { id: topicId, subject: { userId } },
      include: { subject: true },
    });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    const existing = await tx.reviewSchedule.findUnique({ where: { topicId } });

    if (override.kind === 'suspend') {
      await tx.topic.update({ where: { id: topicId }, data: { isSuspended: override.suspended } });
      return { schedule: existing, isSuspended: override.suspended };
    }

    const settings = await tx.userSettings.findUnique({ where: { userId } });
    if (!settings) {
      throw new AppError('NOT_FOUND', 'User settings not found');
    }

    let nextReviewOn: Date;
    if (override.kind === 'setNextReviewOn') {
      nextReviewOn = override.nextReviewOn;
    } else {
      // Snoozing pushes a review `days` past whichever is LATER: its current due date, or the
      // user's today. Counting from a due date in the past would leave an overdue topic overdue
      // (1-day snooze of a topic 10 days overdue = still 9 days overdue).
      const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);
      const current = existing?.nextReviewOn ?? null;
      const base = current && current.getTime() > today.getTime() ? current : today;
      nextReviewOn = addDays(base, override.days);
    }

    const schedule = existing
      ? await tx.reviewSchedule.update({ where: { topicId }, data: { nextReviewOn } })
      : await tx.reviewSchedule.create({
          data: {
            topicId,
            algorithm: resolveAlgorithm(
              topic.algorithmOverride,
              topic.subject.defaultAlgorithm,
              settings.defaultAlgorithm,
            ),
            nextReviewOn,
          },
        });
    return { schedule, isSuspended: topic.isSuspended };
  });
}

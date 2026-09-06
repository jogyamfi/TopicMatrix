import { AppError, addDays, parseManualIntervals, type Algorithm } from '@topicmatrix/shared';
import {
  computeCompetencyScore,
  getScheduler,
  replaySchedule,
  roundScoreForStorage,
  type Grade,
} from '@topicmatrix/core';
import type { Db } from './db.js';
import type { ReviewSchedule } from './types.js';

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
}

/**
 * Recomputes a topic's `ReviewSchedule` from its FULL session history (§8.6) and records a new
 * `CompetencySnapshot`, inside one `UnitOfWork` — every `StudySession` create/update/delete, and
 * every topic algorithm change, calls this rather than patching the schedule incrementally
 * (FR-4.3, FR-4.4, FR-4.7, FR-5.7, FR-7.10). Recomputing from scratch each time is what keeps a
 * back-dated or edited/deleted session consistent with a fresh replay (§8.6).
 */
export async function recalculateTopicSchedule(
  db: Db,
  userId: string,
  topicId: string,
  opts: { asOfDate: Date; triggeredBySessionId?: string | null },
): Promise<RecalculationResult> {
  return db.unitOfWork.run(async (tx) => {
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
    const manualIntervals = parseManualIntervals(settings.manualIntervalsJson);

    const sessions = await tx.studySession.findMany({ where: { topicId } });

    const output = replaySchedule(
      sessions.map((s) => ({
        studiedOn: s.studiedOn,
        accuracy: s.accuracy,
        confidence: s.confidence,
        gradeUsed: (s.gradeUsed as Grade | null) ?? null,
      })),
      scheduler,
      { manualIntervals },
    );

    const existing = await tx.reviewSchedule.findUnique({ where: { topicId } });
    const previousNextReviewOn = existing?.nextReviewOn?.getTime() ?? null;

    let schedule: ReviewSchedule | null;
    if (!output) {
      // No sessions left (e.g. the last one was just deleted) — no schedule should exist either,
      // rather than leaving stale scheduling state behind from before the delete.
      if (existing) {
        await tx.reviewSchedule.delete({ where: { topicId } });
      }
      schedule = null;
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
      // `isSuspended` is a user preference (FR-5.10, set via applyScheduleOverride), not part of
      // the scheduler's own state — deliberately left untouched by this update.
      schedule = await tx.reviewSchedule.upsert({
        where: { topicId },
        create: { topicId, ...scheduleData },
        update: scheduleData,
      });
    }

    const scoreResult = computeCompetencyScore({
      sessions: sessions.map((s) => ({
        studiedOn: s.studiedOn,
        questionsAttempted: s.questionsAttempted,
        accuracy: s.accuracy,
        confidence: s.confidence,
      })),
      asOfDate: opts.asOfDate,
      currentIntervalDays: output?.intervalDays ?? null,
      weights: {
        accuracy: settings.weightAccuracy,
        confidence: settings.weightConfidence,
        recency: settings.weightRecency,
      },
    });

    // Zero sessions -> null score (§7.2) -> no fabricated snapshot, matching packages/core's own
    // "never record a 0" convention.
    if (scoreResult.score !== null) {
      await tx.competencySnapshot.create({
        data: {
          topicId,
          capturedOn: opts.asOfDate,
          score: roundScoreForStorage(scoreResult.score),
          accuracyComponent: scoreResult.accuracyComponent ?? 0,
          confidenceComponent: scoreResult.confidenceComponent ?? 0,
          recencyComponent: scoreResult.recencyComponent ?? 0,
          triggeredBySessionId: opts.triggeredBySessionId ?? null,
        },
      });
    }

    return {
      schedule,
      algorithm,
      datesChanged: previousNextReviewOn !== (schedule?.nextReviewOn?.getTime() ?? null),
    };
  });
}

export type ScheduleOverride =
  | { kind: 'setNextReviewOn'; nextReviewOn: Date }
  | { kind: 'snooze'; days: number }
  | { kind: 'suspend'; suspended: boolean };

/**
 * User-driven schedule overrides (FR-5.6, FR-5.10) — independent of session history. Applied
 * directly, not through `recalculateTopicSchedule`, since these aren't derived from a replay.
 * Creates a schedule row (with the resolved algorithm) if the topic has never had one, so a
 * never-studied topic can still be suspended or given an explicit next-review date.
 */
export async function applyScheduleOverride(
  db: Db,
  userId: string,
  topicId: string,
  override: ScheduleOverride,
  asOfDate: Date,
): Promise<ReviewSchedule> {
  return db.unitOfWork.run(async (tx) => {
    const topic = await tx.topic.findFirst({
      where: { id: topicId, subject: { userId } },
      include: { subject: true },
    });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    // Captured so the closure below can rely on it being non-null — flow narrowing from the
    // `if` above doesn't carry into a nested function declaration.
    const ownedTopic = topic;
    const existing = await tx.reviewSchedule.findUnique({ where: { topicId } });

    async function resolvedAlgorithmForNewSchedule(): Promise<Algorithm> {
      const settings = await tx.userSettings.findUnique({ where: { userId } });
      if (!settings) {
        throw new AppError('NOT_FOUND', 'User settings not found');
      }
      return resolveAlgorithm(
        ownedTopic.algorithmOverride,
        ownedTopic.subject.defaultAlgorithm,
        settings.defaultAlgorithm,
      );
    }

    if (override.kind === 'suspend') {
      if (existing) {
        return tx.reviewSchedule.update({ where: { topicId }, data: { isSuspended: override.suspended } });
      }
      return tx.reviewSchedule.create({
        data: { topicId, algorithm: await resolvedAlgorithmForNewSchedule(), isSuspended: override.suspended },
      });
    }

    const nextReviewOn =
      override.kind === 'setNextReviewOn'
        ? override.nextReviewOn
        : addDays(existing?.nextReviewOn ?? asOfDate, override.days);

    if (existing) {
      return tx.reviewSchedule.update({ where: { topicId }, data: { nextReviewOn } });
    }
    return tx.reviewSchedule.create({
      data: { topicId, algorithm: await resolvedAlgorithmForNewSchedule(), nextReviewOn },
    });
  });
}

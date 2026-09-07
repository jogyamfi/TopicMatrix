// Live preview of a proposed scoring-weight/threshold change against a sample topic (FR-8.2
// task 2, P10) \u2014 lets the settings UI show "here's what this would do to a real topic" before
// the user saves. Deliberately a standalone module rather than a `topic-metrics.ts` reuse: that
// module always uses the user's *stored* settings, whereas this one needs to score the same
// topic twice, once under the stored weights and once under the caller-supplied proposed ones.
import { AppError, startOfUserDay } from '@topicmatrix/shared';
import { computeCompetencyScore, computeHealthStatus, daysBetween } from '@topicmatrix/core';
import type { ScoringWeights } from '@topicmatrix/core';
import type { Db } from './db.js';

export interface SettingsPreviewWeightsAndThresholds extends ScoringWeights {
  readonly strongThreshold: number;
  readonly needsReviewThreshold: number;
}

export interface SettingsPreviewSide {
  readonly score: number | null;
  readonly healthStatus: string;
}

export interface SettingsPreviewResult {
  readonly topicId: string;
  readonly topicName: string;
  readonly current: SettingsPreviewSide;
  readonly proposed: SettingsPreviewSide;
}

/** The user's own topic with the most logged sessions \u2014 a representative "sample topic" (task 2). */
async function findSampleTopicId(db: Db, userId: string): Promise<string | null> {
  const [topics, sessions] = await Promise.all([
    db.topics.listAllForUser(userId),
    db.studySessions.listAllForUser(userId),
  ]);
  if (topics.length === 0) {
    return null;
  }
  const sessionCounts = new Map<string, number>();
  for (const session of sessions) {
    sessionCounts.set(session.topicId, (sessionCounts.get(session.topicId) ?? 0) + 1);
  }
  return [...topics].sort((a, b) => (sessionCounts.get(b.id) ?? 0) - (sessionCounts.get(a.id) ?? 0))[0]?.id ?? null;
}

export async function computeSettingsPreview(
  db: Db,
  userId: string,
  asOfDate: Date,
  proposed: SettingsPreviewWeightsAndThresholds,
  topicId?: string,
): Promise<SettingsPreviewResult | null> {
  const settingsRow = await db.userSettings.find(userId);
  if (!settingsRow) {
    throw new AppError('NOT_FOUND', 'User settings not found');
  }
  // Captured into its own const, not just narrowed in this scope: a nested function declared
  // below (`scoreWith`) does not inherit `if (!x) throw` narrowing from an enclosing scope.
  const settings = settingsRow;

  const resolvedTopicId = topicId ?? (await findSampleTopicId(db, userId));
  if (!resolvedTopicId) {
    return null;
  }
  const topic = await db.topics.findById(userId, resolvedTopicId);
  if (!topic) {
    throw new AppError('NOT_FOUND', 'Topic not found');
  }

  const [sessions, schedule] = await Promise.all([
    db.studySessions.listByTopic(userId, topic.id),
    db.reviewSchedules.find(userId, topic.id),
  ]);

  const today = startOfUserDay(asOfDate, settings.timezone, settings.dayStartHour);
  const overdueDays = schedule?.nextReviewOn
    ? Math.max(0, Math.round(daysBetween(schedule.nextReviewOn, today)))
    : 0;
  let lastSessionOn: Date | null = null;
  for (const session of sessions) {
    if (!lastSessionOn || session.studiedOn > lastSessionOn) {
      lastSessionOn = session.studiedOn;
    }
  }
  const daysSinceLastSession = lastSessionOn ? daysBetween(lastSessionOn, asOfDate) : null;

  function scoreWith(weightsAndThresholds: SettingsPreviewWeightsAndThresholds): SettingsPreviewSide {
    const result = computeCompetencyScore({
      sessions: sessions.map((s) => ({
        studiedOn: s.studiedOn,
        questionsAttempted: s.questionsAttempted,
        accuracy: s.accuracy,
        confidence: s.confidence,
      })),
      asOfDate,
      currentIntervalDays: schedule?.intervalDays ?? null,
      weights: {
        accuracy: weightsAndThresholds.accuracy,
        confidence: weightsAndThresholds.confidence,
        recency: weightsAndThresholds.recency,
      },
    });
    const healthStatus = computeHealthStatus({
      score: result.score,
      overdueDays,
      daysSinceLastSession,
      strongThreshold: weightsAndThresholds.strongThreshold,
      needsReviewThreshold: weightsAndThresholds.needsReviewThreshold,
      neglectThresholdDays: settings.neglectThresholdDays,
    });
    return { score: result.score, healthStatus };
  }

  return {
    topicId: topic.id,
    topicName: topic.name,
    current: scoreWith({
      accuracy: settings.weightAccuracy,
      confidence: settings.weightConfidence,
      recency: settings.weightRecency,
      strongThreshold: settings.strongThreshold,
      needsReviewThreshold: settings.needsReviewThreshold,
    }),
    proposed: scoreWith(proposed),
  };
}

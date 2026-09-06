// Competency scoring (§7): recency-weighted score, roll-up, health status, progress status.
// All pure functions of their arguments — `asOfDate` is always passed in, never `Date.now()`.
import { daysBetween } from './date-utils.js';
import { DEFAULT_SCORING_WEIGHTS, RECENCY_HALF_LIFE_DAYS, type ScoringWeights } from './types.js';

export interface ScoringSessionInput {
  readonly studiedOn: Date;
  readonly questionsAttempted: number;
  /** 0..1, computed server-side from `questionsCorrect`/`questionsAttempted` (FR-4.2). */
  readonly accuracy: number;
  /** 1..5. */
  readonly confidence: number;
}

export interface CompetencyScoreInput {
  readonly sessions: readonly ScoringSessionInput[];
  readonly asOfDate: Date;
  /** The topic's current scheduling interval in days; `null` if no schedule exists yet. */
  readonly currentIntervalDays: number | null;
  readonly weights?: ScoringWeights;
}

export interface CompetencyScoreResult {
  /** `null` with zero sessions (§7.2) — never 0, which would look like "answered everything wrong". */
  readonly score: number | null;
  readonly accuracyComponent: number | null;
  readonly confidenceComponent: number | null;
  readonly recencyComponent: number | null;
  /** True until 3 sessions exist (§7.2); the UI marks the score provisional while this holds. */
  readonly isProvisional: boolean;
}

/** `w_i = 0.5 ^ (daysAgo / halfLifeDays)` (§7.1). */
export function computeRecencyWeight(
  daysAgo: number,
  halfLifeDays: number = RECENCY_HALF_LIFE_DAYS,
): number {
  return Math.pow(0.5, daysAgo / halfLifeDays);
}

/** Throws if `weights` don't sum to 1.0 (within floating-point tolerance), per §7.1/FR-8.2. */
export function validateScoringWeights(weights: ScoringWeights): void {
  const total = weights.accuracy + weights.confidence + weights.recency;
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`Scoring weights must sum to 1.0, got ${total}`);
  }
}

export function computeCompetencyScore(input: CompetencyScoreInput): CompetencyScoreResult {
  const { sessions, asOfDate, currentIntervalDays } = input;
  const weights = input.weights ?? DEFAULT_SCORING_WEIGHTS;

  if (sessions.length === 0) {
    return {
      score: null,
      accuracyComponent: null,
      confidenceComponent: null,
      recencyComponent: null,
      isProvisional: false,
    };
  }

  let accuracyNumerator = 0;
  let accuracyDenominator = 0;
  let confidenceNumerator = 0;
  let confidenceDenominator = 0;

  for (const session of sessions) {
    const daysAgo = Math.max(0, daysBetween(session.studiedOn, asOfDate));
    const w = computeRecencyWeight(daysAgo);
    accuracyNumerator += w * session.questionsAttempted * session.accuracy;
    accuracyDenominator += w * session.questionsAttempted;
    confidenceNumerator += w * ((session.confidence - 1) / 4);
    confidenceDenominator += w;
  }

  const accuracyComponent = accuracyDenominator > 0 ? accuracyNumerator / accuracyDenominator : 0;
  const confidenceComponent =
    confidenceDenominator > 0 ? confidenceNumerator / confidenceDenominator : 0;

  const mostRecentStudiedOnMs = Math.max(...sessions.map((s) => s.studiedOn.getTime()));
  const deltaT = Math.max(0, daysBetween(new Date(mostRecentStudiedOnMs), asOfDate));
  const interval = Math.max(currentIntervalDays ?? 1, 1);
  const recencyComponent = Math.exp(-deltaT / interval);

  const raw =
    100 *
    (weights.accuracy * accuracyComponent +
      weights.confidence * confidenceComponent +
      weights.recency * recencyComponent);
  const score = Math.min(100, Math.max(0, raw));

  return {
    score,
    accuracyComponent,
    confidenceComponent,
    recencyComponent,
    isProvisional: sessions.length < 3,
  };
}

/** Rounds a score to 1 decimal place, for storage in `CompetencySnapshot.score` (§7.2). */
export function roundScoreForStorage(score: number): number {
  return Math.round(score * 10) / 10;
}

/** Rounds a score to the nearest integer, for display (§7.2). */
export function roundScoreForDisplay(score: number): number {
  return Math.round(score);
}

export interface TopicScoreForRollup {
  /** The topic's own score; `null` (zero sessions) excludes it from the roll-up (§7.3). */
  readonly score: number | null;
  /** Total questions attempted in the trailing 180 days — the roll-up's weight (§7.3). */
  readonly questionsAttempted180d: number;
}

/**
 * Weighted mean over topics with a score, weighted by trailing-180-day activity (§7.3). If every
 * scored topic's activity is outside that window (total weight 0) but history exists, this falls
 * back to an unweighted mean of their scores rather than reporting no score at all — the SRS
 * doesn't specify this edge case; revisit at P4/P9 if it disagrees with the intended UX.
 */
export function computeRollupScore(topics: readonly TopicScoreForRollup[]): number | null {
  const scored = topics.filter(
    (t): t is TopicScoreForRollup & { score: number } => t.score !== null,
  );
  if (scored.length === 0) {
    return null;
  }

  const totalWeight = scored.reduce((sum, t) => sum + t.questionsAttempted180d, 0);
  if (totalWeight === 0) {
    return scored.reduce((sum, t) => sum + t.score, 0) / scored.length;
  }

  const weightedSum = scored.reduce((sum, t) => sum + t.score * t.questionsAttempted180d, 0);
  return weightedSum / totalWeight;
}

export type HealthStatus = 'notStarted' | 'strong' | 'needsReview' | 'atRisk';

export interface HealthStatusInput {
  readonly score: number | null;
  /** Days overdue (`asOfDate` minus `nextReviewOn`), clamped to >= 0; 0 if not (yet) overdue. */
  readonly overdueDays: number;
  /** Days since the last session; `null` if there has never been one. */
  readonly daysSinceLastSession: number | null;
  readonly strongThreshold: number;
  readonly needsReviewThreshold: number;
  readonly neglectThresholdDays: number;
}

/** §7.4. Checked most-severe-first, since the 🔴/🟡 conditions are `OR`s that can hold at any score. */
export function computeHealthStatus(input: HealthStatusInput): HealthStatus {
  const { score, overdueDays, daysSinceLastSession, strongThreshold, needsReviewThreshold } =
    input;
  if (score === null) {
    return 'notStarted';
  }

  const isNeglected =
    daysSinceLastSession !== null && daysSinceLastSession >= input.neglectThresholdDays;
  if (score < needsReviewThreshold || overdueDays > 7 || isNeglected) {
    return 'atRisk';
  }
  if (score < strongThreshold || (score >= strongThreshold && overdueDays > 0)) {
    return 'needsReview';
  }
  return 'strong';
}

export type ProgressStatus = 'notStarted' | 'inProgress' | 'needsReview' | 'mastered';

export interface ProgressStatusInput {
  readonly sessionCount: number;
  readonly score: number | null;
  readonly currentIntervalDays: number | null;
  /** Whether any of the topic's last 3 sessions used grade 1 (Again). */
  readonly lapseInLastThreeSessions: boolean;
  /** Whether `nextReviewOn <= asOfDate`. */
  readonly isDueOrOverdue: boolean;
}

const MASTERED_SCORE_THRESHOLD = 85;
const MASTERED_MIN_SESSIONS = 3;
const MASTERED_MIN_INTERVAL_DAYS = 30;

/**
 * §7.5. A topic can satisfy both "due today" and "Mastered" at once (a long, stable interval
 * elapsing is exactly what "due" means); this resolves that overlap by surfacing "Needs Review"
 * first, since that's the actionable state the UI most needs to highlight. Revisit at P7/P9 if
 * that reads wrong once it's on screen.
 */
export function computeProgressStatus(input: ProgressStatusInput): ProgressStatus {
  if (input.sessionCount === 0) {
    return 'notStarted';
  }
  if (input.isDueOrOverdue) {
    return 'needsReview';
  }
  if (
    input.score !== null &&
    input.score >= MASTERED_SCORE_THRESHOLD &&
    input.sessionCount >= MASTERED_MIN_SESSIONS &&
    (input.currentIntervalDays ?? 0) >= MASTERED_MIN_INTERVAL_DAYS &&
    !input.lapseInLastThreeSessions
  ) {
    return 'mastered';
  }
  return 'inProgress';
}

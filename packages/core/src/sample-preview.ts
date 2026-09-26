// Scoring a fixed "sample" topic under a given set of weights and thresholds (FR-8.2's live
// preview). Pure, so the server (which picks and loads the sample) and the web client (which
// re-scores it on every keystroke without a round trip) share one implementation and can't
// disagree about what a proposed setting would do.
import {
  computeCompetencyScore,
  computeHealthStatus,
  type HealthStatus,
  type ScoringSessionInput,
} from './scoring.js';
import type { ScoringWeights } from './types.js';

/** Everything scoring and health classification need about the sample topic, frozen at one instant. */
export interface ScoringSample {
  readonly sessions: readonly ScoringSessionInput[];
  readonly asOfDate: Date;
  readonly currentIntervalDays: number | null;
  readonly overdueDays: number;
  readonly daysSinceLastSession: number | null;
  readonly neglectThresholdDays: number;
}

export interface WeightsAndThresholds extends ScoringWeights {
  readonly strongThreshold: number;
  readonly needsReviewThreshold: number;
}

export interface SampleScore {
  readonly score: number | null;
  readonly healthStatus: HealthStatus;
}

export function scoreSample(sample: ScoringSample, settings: WeightsAndThresholds): SampleScore {
  const result = computeCompetencyScore({
    sessions: sample.sessions,
    asOfDate: sample.asOfDate,
    currentIntervalDays: sample.currentIntervalDays,
    weights: { accuracy: settings.accuracy, confidence: settings.confidence, recency: settings.recency },
  });
  const healthStatus = computeHealthStatus({
    score: result.score,
    overdueDays: sample.overdueDays,
    daysSinceLastSession: sample.daysSinceLastSession,
    strongThreshold: settings.strongThreshold,
    needsReviewThreshold: settings.needsReviewThreshold,
    neglectThresholdDays: sample.neglectThresholdDays,
  });
  return { score: result.score, healthStatus };
}

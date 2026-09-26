import { describe, expect, it } from 'vitest';
import { scoreSample, type ScoringSample } from './sample-preview.js';
import { computeCompetencyScore } from './scoring.js';

const asOfDate = new Date(Date.UTC(2026, 8, 26));
const sample: ScoringSample = {
  sessions: [
    { studiedOn: new Date(Date.UTC(2026, 8, 20)), questionsAttempted: 10, accuracy: 0.8, confidence: 4 },
    { studiedOn: new Date(Date.UTC(2026, 8, 10)), questionsAttempted: 20, accuracy: 0.5, confidence: 2 },
  ],
  asOfDate,
  currentIntervalDays: 7,
  overdueDays: 0,
  daysSinceLastSession: 6,
  neglectThresholdDays: 30,
};

describe('scoreSample', () => {
  it('scores with the given weights — the same number computeCompetencyScore gives', () => {
    const weights = { accuracy: 0.5, confidence: 0.3, recency: 0.2 };
    const expected = computeCompetencyScore({
      sessions: sample.sessions,
      asOfDate,
      currentIntervalDays: 7,
      weights,
    }).score;
    expect(scoreSample(sample, { ...weights, strongThreshold: 75, needsReviewThreshold: 50 }).score).toBe(expected);
  });

  it('classifies health with the proposed thresholds, so moving them changes the status', () => {
    const weights = { accuracy: 0.6, confidence: 0.25, recency: 0.15 };
    const { score } = scoreSample(sample, { ...weights, strongThreshold: 75, needsReviewThreshold: 50 });
    expect(score).not.toBeNull();
    const at = (strongThreshold: number) =>
      scoreSample(sample, { ...weights, strongThreshold, needsReviewThreshold: 10 }).healthStatus;
    expect(at((score ?? 0) - 1)).toBe('strong');
    expect(at((score ?? 0) + 1)).toBe('needsReview');
  });

  it('reports a never-studied sample as not started', () => {
    const empty = { ...sample, sessions: [], daysSinceLastSession: null };
    expect(scoreSample(empty, { accuracy: 0.6, confidence: 0.25, recency: 0.15, strongThreshold: 75, needsReviewThreshold: 50 })).toEqual({
      score: null,
      healthStatus: 'notStarted',
    });
  });
});

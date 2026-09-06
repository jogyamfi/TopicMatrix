import { describe, expect, it } from 'vitest';
import {
  computeCompetencyScore,
  computeHealthStatus,
  computeProgressStatus,
  computeRecencyWeight,
  computeRollupScore,
  roundScoreForDisplay,
  roundScoreForStorage,
  validateScoringWeights,
  type ScoringSessionInput,
} from './scoring.js';

const DAY = 86_400_000;
const asOf = new Date('2026-09-06T00:00:00.000Z');
const daysAgo = (n: number) => new Date(asOf.getTime() - n * DAY);

function session(overrides: Partial<ScoringSessionInput> = {}): ScoringSessionInput {
  return {
    studiedOn: asOf,
    questionsAttempted: 10,
    accuracy: 0.8,
    confidence: 4,
    ...overrides,
  };
}

describe('computeRecencyWeight', () => {
  it('is 0.5 exactly at the half-life', () => {
    expect(computeRecencyWeight(30)).toBeCloseTo(0.5);
  });
  it('is 1 at zero days', () => {
    expect(computeRecencyWeight(0)).toBe(1);
  });
  it('is 0.25 at two half-lives', () => {
    expect(computeRecencyWeight(60)).toBeCloseTo(0.25);
  });
});

describe('validateScoringWeights', () => {
  it('accepts weights summing to 1.0', () => {
    expect(() =>
      validateScoringWeights({ accuracy: 0.6, confidence: 0.25, recency: 0.15 }),
    ).not.toThrow();
  });
  it('rejects weights that do not sum to 1.0', () => {
    expect(() =>
      validateScoringWeights({ accuracy: 0.5, confidence: 0.25, recency: 0.15 }),
    ).toThrow();
  });
});

describe('computeCompetencyScore', () => {
  it('returns null (never 0) for zero sessions', () => {
    const result = computeCompetencyScore({ sessions: [], asOfDate: asOf, currentIntervalDays: null });
    expect(result.score).toBeNull();
    expect(result.accuracyComponent).toBeNull();
    expect(result.isProvisional).toBe(false);
  });

  it('is provisional with fewer than 3 sessions, not provisional from 3 onward', () => {
    const one = computeCompetencyScore({
      sessions: [session()],
      asOfDate: asOf,
      currentIntervalDays: 1,
    });
    expect(one.isProvisional).toBe(true);
    expect(one.score).not.toBeNull();

    const two = computeCompetencyScore({
      sessions: [session(), session({ studiedOn: daysAgo(1) })],
      asOfDate: asOf,
      currentIntervalDays: 1,
    });
    expect(two.isProvisional).toBe(true);

    const three = computeCompetencyScore({
      sessions: [session(), session({ studiedOn: daysAgo(1) }), session({ studiedOn: daysAgo(2) })],
      asOfDate: asOf,
      currentIntervalDays: 1,
    });
    expect(three.isProvisional).toBe(false);
  });

  it('weights accuracy by question count, not just by session count', () => {
    // A 2-question session and a 50-question session, both today (equal recency weight), with
    // very different accuracies: the 50-question session should dominate the accuracy component.
    const result = computeCompetencyScore({
      sessions: [
        session({ questionsAttempted: 2, accuracy: 0.0 }),
        session({ questionsAttempted: 50, accuracy: 1.0 }),
      ],
      asOfDate: asOf,
      currentIntervalDays: 1,
    });
    // Expected: (2*0 + 50*1) / 52
    expect(result.accuracyComponent).toBeCloseTo(50 / 52);
  });

  it('normalises confidence to 0..1 via (c-1)/4', () => {
    const result = computeCompetencyScore({
      sessions: [session({ confidence: 1 })],
      asOfDate: asOf,
      currentIntervalDays: 1,
    });
    expect(result.confidenceComponent).toBeCloseTo(0);

    const result5 = computeCompetencyScore({
      sessions: [session({ confidence: 5 })],
      asOfDate: asOf,
      currentIntervalDays: 1,
    });
    expect(result5.confidenceComponent).toBeCloseTo(1);
  });

  it('recency component is exp(-1) ~= 0.37 exactly when overdue equals the interval', () => {
    const result = computeCompetencyScore({
      sessions: [session({ studiedOn: daysAgo(10) })],
      asOfDate: asOf,
      currentIntervalDays: 10,
    });
    expect(result.recencyComponent).toBeCloseTo(Math.exp(-1));
  });

  it('recency component is 1.0 immediately after review', () => {
    const result = computeCompetencyScore({
      sessions: [session({ studiedOn: asOf })],
      asOfDate: asOf,
      currentIntervalDays: 30,
    });
    expect(result.recencyComponent).toBeCloseTo(1);
  });

  it('clamps the final score to [0, 100]', () => {
    const perfect = computeCompetencyScore({
      sessions: [session({ accuracy: 1, confidence: 5 })],
      asOfDate: asOf,
      currentIntervalDays: 30,
    });
    expect(perfect.score).toBeLessThanOrEqual(100);
    expect(perfect.score).toBeGreaterThanOrEqual(0);

    const worst = computeCompetencyScore({
      sessions: [session({ accuracy: 0, confidence: 1, studiedOn: daysAgo(1000) })],
      asOfDate: asOf,
      currentIntervalDays: 1,
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
  });

  it('is monotonic in accuracy, holding everything else equal (property test)', () => {
    const scoreAt = (accuracy: number) =>
      computeCompetencyScore({
        sessions: [session({ accuracy })],
        asOfDate: asOf,
        currentIntervalDays: 10,
      }).score;

    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((a) => scoreAt(a) as number);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] as number);
    }
  });
});

describe('roundScoreForStorage / roundScoreForDisplay', () => {
  it('rounds to 1dp for storage and to an integer for display', () => {
    expect(roundScoreForStorage(74.449)).toBe(74.4);
    expect(roundScoreForStorage(74.451)).toBe(74.5);
    expect(roundScoreForDisplay(74.449)).toBe(74);
    expect(roundScoreForDisplay(74.5)).toBe(75);
  });
});

describe('computeRollupScore', () => {
  it('excludes topics with no sessions (null score) rather than counting them as zero', () => {
    const result = computeRollupScore([
      { score: 80, questionsAttempted180d: 10 },
      { score: null, questionsAttempted180d: 0 },
    ]);
    expect(result).toBe(80);
  });

  it('is null when nothing in the subtree has ever been studied', () => {
    expect(computeRollupScore([{ score: null, questionsAttempted180d: 0 }])).toBeNull();
    expect(computeRollupScore([])).toBeNull();
  });

  it('weights by trailing-180-day questions attempted', () => {
    const result = computeRollupScore([
      { score: 100, questionsAttempted180d: 10 },
      { score: 0, questionsAttempted180d: 90 },
    ]);
    // (100*10 + 0*90) / 100 = 10
    expect(result).toBeCloseTo(10);
  });

  it('falls back to an unweighted mean when total recent weight is zero', () => {
    const result = computeRollupScore([
      { score: 60, questionsAttempted180d: 0 },
      { score: 80, questionsAttempted180d: 0 },
    ]);
    expect(result).toBeCloseTo(70);
  });
});

describe('computeHealthStatus', () => {
  const base = {
    overdueDays: 0,
    daysSinceLastSession: 1,
    strongThreshold: 75,
    needsReviewThreshold: 50,
    neglectThresholdDays: 30,
  };

  it('is notStarted with a null score', () => {
    expect(computeHealthStatus({ ...base, score: null })).toBe('notStarted');
  });

  it('is strong at >= 75 and not overdue', () => {
    expect(computeHealthStatus({ ...base, score: 75 })).toBe('strong');
    expect(computeHealthStatus({ ...base, score: 90 })).toBe('strong');
  });

  it('is needsReview for 50 <= score < 75', () => {
    expect(computeHealthStatus({ ...base, score: 50 })).toBe('needsReview');
    expect(computeHealthStatus({ ...base, score: 74.9 })).toBe('needsReview');
  });

  it('is needsReview for score >= 75 but overdue by <= 7 days', () => {
    expect(computeHealthStatus({ ...base, score: 90, overdueDays: 1 })).toBe('needsReview');
    expect(computeHealthStatus({ ...base, score: 90, overdueDays: 7 })).toBe('needsReview');
  });

  it('is atRisk for score < 50', () => {
    expect(computeHealthStatus({ ...base, score: 49.9 })).toBe('atRisk');
  });

  it('is atRisk when overdue by > 7 days, regardless of score', () => {
    expect(computeHealthStatus({ ...base, score: 100, overdueDays: 8 })).toBe('atRisk');
  });

  it('is atRisk when neglected, regardless of score', () => {
    expect(
      computeHealthStatus({ ...base, score: 100, daysSinceLastSession: 30, neglectThresholdDays: 30 }),
    ).toBe('atRisk');
  });
});

describe('computeProgressStatus', () => {
  const base = {
    sessionCount: 5,
    score: 90,
    currentIntervalDays: 30,
    lapseInLastThreeSessions: false,
    isDueOrOverdue: false,
  };

  it('is notStarted with zero sessions', () => {
    expect(computeProgressStatus({ ...base, sessionCount: 0 })).toBe('notStarted');
  });

  it('is mastered at score >= 85, >= 3 sessions, interval >= 30, no recent lapse', () => {
    expect(computeProgressStatus(base)).toBe('mastered');
  });

  it('is not mastered if any condition fails', () => {
    expect(computeProgressStatus({ ...base, score: 84.9 })).toBe('inProgress');
    expect(computeProgressStatus({ ...base, sessionCount: 2 })).toBe('inProgress');
    expect(computeProgressStatus({ ...base, currentIntervalDays: 29 })).toBe('inProgress');
    expect(computeProgressStatus({ ...base, lapseInLastThreeSessions: true })).toBe('inProgress');
  });

  it('is needsReview when due or overdue, even if otherwise mastered', () => {
    expect(computeProgressStatus({ ...base, isDueOrOverdue: true })).toBe('needsReview');
  });
});

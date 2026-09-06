// SM-2 scheduler (§8.3, D3) — hand-written, no external dependency.
import { addUtcDays } from '../date-utils.js';
import type { Grade, Scheduler, SchedulerInput, SchedulerOutput, ScheduleState } from '../types.js';

export const SM2_INITIAL_EASE_FACTOR = 2.5;
export const SM2_EASE_FACTOR_FLOOR = 1.3;

/** Grades 1-4 map to SuperMemo's quality scale 1/3/4/5 (§8.3). */
const SM2_QUALITY_BY_GRADE: Record<Grade, number> = { 1: 1, 2: 3, 3: 4, 4: 5 };

export const sm2Scheduler: Scheduler = {
  id: 'sm2',
  schedule(input: SchedulerInput): SchedulerOutput {
    const quality = SM2_QUALITY_BY_GRADE[input.grade];
    const priorEaseFactor = input.state?.easeFactor ?? SM2_INITIAL_EASE_FACTOR;
    // EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)), applied for every grade, not just passes.
    const easeFactor = Math.max(
      SM2_EASE_FACTOR_FLOOR,
      priorEaseFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    );

    let repetitions: number;
    let intervalDays: number;
    let lapses = input.state?.lapses ?? 0;

    if (input.grade === 1) {
      repetitions = 0;
      intervalDays = 1;
      lapses += 1;
    } else {
      const priorRepetitions = input.state?.repetitions ?? 0;
      repetitions = priorRepetitions + 1;
      if (priorRepetitions === 0) {
        intervalDays = 1;
      } else if (priorRepetitions === 1) {
        intervalDays = 6;
      } else {
        const priorIntervalDays = input.state?.intervalDays ?? 1;
        intervalDays = Math.round(priorIntervalDays * easeFactor);
      }
    }

    const nextReviewOn = addUtcDays(input.reviewedOn, intervalDays);
    const state: ScheduleState = {
      lastReviewedOn: input.reviewedOn,
      intervalDays,
      repetitions,
      lapses,
      easeFactor,
      stability: null,
      difficulty: null,
      manualLadderIndex: null,
    };

    return { nextReviewOn, intervalDays, state };
  },
};

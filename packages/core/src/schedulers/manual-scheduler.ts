// Manual scheduler (§8.4, D3) — a fixed ladder of intervals, advanced or reset by grade.
import { DEFAULT_MANUAL_INTERVALS } from '@topicmatrix/shared';
import { addUtcDays } from '../date-utils.js';
import type { Scheduler, SchedulerInput, SchedulerOutput, ScheduleState } from '../types.js';

export const manualScheduler: Scheduler = {
  id: 'manual',
  schedule(input: SchedulerInput): SchedulerOutput {
    const ladder =
      input.settings.manualIntervals.length > 0
        ? input.settings.manualIntervals
        : DEFAULT_MANUAL_INTERVALS;

    // No rung yet (first review) starts at index 0 either way; a lapse resets to index 0; any
    // other grade advances one rung, capped at the ladder's last entry (§8.4).
    const priorIndex = input.state?.manualLadderIndex ?? -1;
    const index = input.grade === 1 ? 0 : Math.min(priorIndex + 1, ladder.length - 1);
    const intervalDays = ladder[index] ?? ladder[ladder.length - 1] ?? 1;

    const repetitions = (input.state?.repetitions ?? 0) + 1;
    const lapses = (input.state?.lapses ?? 0) + (input.grade === 1 ? 1 : 0);

    const nextReviewOn = addUtcDays(input.reviewedOn, intervalDays);
    const state: ScheduleState = {
      lastReviewedOn: input.reviewedOn,
      intervalDays,
      repetitions,
      lapses,
      easeFactor: null,
      stability: null,
      difficulty: null,
      manualLadderIndex: index,
    };

    return { nextReviewOn, intervalDays, state };
  },
};

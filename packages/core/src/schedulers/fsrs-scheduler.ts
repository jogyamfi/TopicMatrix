// FSRS scheduler (§8.2, D3) — a thin, deterministic wrapper around `ts-fsrs`.
//
// Two deliberate parameter choices away from `ts-fsrs`'s own defaults:
// - `enable_short_term: false` — without it, first reviews are scheduled in minutes via Anki-style
//   learning steps, which is meaningless for an app that only tracks date-only `studiedOn`/
//   `nextReviewOn` (§6.3). Disabling it sends every card straight to long-term (day-granularity)
//   scheduling, which is what this product actually needs.
// - `enable_fuzz: false` — replay (§8.6) must be a deterministic pure function of history; fuzz
//   would make two replays of the same sessions produce different schedules.
import { createEmptyCard, fsrs, State, type Card, type Grade as FsrsGrade } from 'ts-fsrs';
import { addUtcDays } from '../date-utils.js';
import type { Scheduler, SchedulerInput, SchedulerOutput, ScheduleState } from '../types.js';

/** Requested retention default per §8.2. Not currently user-configurable (no such UserSettings field). */
export const FSRS_REQUESTED_RETENTION = 0.9;

const engine = fsrs({
  request_retention: FSRS_REQUESTED_RETENTION,
  enable_short_term: false,
  enable_fuzz: false,
});

// A topic is scheduled at most once per day in this product, so a review is always at least a
// day out — `Card.due` isn't read by `next()`'s scheduling math (only `last_review` and `state`
// are, confirmed against ts-fsrs's `AbstractScheduler.init()`), so any placeholder value is safe.
function toFsrsCard(state: ScheduleState | null): Card {
  if (!state) {
    return createEmptyCard();
  }
  return {
    due: state.lastReviewedOn,
    stability: state.stability ?? 0,
    difficulty: state.difficulty ?? 0,
    elapsed_days: 0,
    scheduled_days: state.intervalDays,
    learning_steps: 0,
    reps: state.repetitions,
    lapses: state.lapses,
    state: State.Review,
    last_review: state.lastReviewedOn,
  };
}

export const fsrsScheduler: Scheduler = {
  id: 'fsrs',
  schedule(input: SchedulerInput): SchedulerOutput {
    const card = toFsrsCard(input.state);
    // `Grade` (1|2|3|4) and ts-fsrs's own `Grade` (Rating.Again..Easy, also 1|2|3|4) are the same
    // four values; the double cast is needed because TS enums are nominal, not structural.
    const rating = input.grade as unknown as FsrsGrade;
    const { card: nextCard } = engine.next(card, input.reviewedOn, rating);

    // Floored at 1: with only date-granularity tracking, "review again later today" isn't
    // representable, so the earliest a card can come back is the next day.
    const intervalDays = Math.max(1, Math.round(nextCard.scheduled_days));
    const nextReviewOn = addUtcDays(input.reviewedOn, intervalDays);

    const state: ScheduleState = {
      lastReviewedOn: input.reviewedOn,
      intervalDays,
      repetitions: nextCard.reps,
      lapses: nextCard.lapses,
      easeFactor: null,
      stability: nextCard.stability,
      difficulty: nextCard.difficulty,
      manualLadderIndex: null,
    };

    return { nextReviewOn, intervalDays, state };
  },
};

// Shared types for scoring, scheduling and replay (SRS §7, §8). Everything in this package is
// a pure function of its explicit arguments — no I/O, no `Date.now()`, no reads from db/http.
import type { Algorithm } from '@topicmatrix/shared';

/** The 1-4 outcome grade produced by §8.1's accuracy/confidence blend (Again/Hard/Good/Easy). */
export type Grade = 1 | 2 | 3 | 4;

export interface ScoringWeights {
  readonly accuracy: number;
  readonly confidence: number;
  readonly recency: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  accuracy: 0.6,
  confidence: 0.25,
  recency: 0.15,
};

/** §7.1's recency weight half-life, in days. Not user-configurable (only the weights are, FR-8.2). */
export const RECENCY_HALF_LIFE_DAYS = 30;

/**
 * Persisted scheduling state for one topic, algorithm-agnostic. Mirrors `ReviewSchedule`'s
 * scheduling columns (minus `topicId`/`algorithm`/`nextReviewOn`/`isSuspended`, which are
 * orchestration concerns owned by the caller, not the pure scheduling state itself).
 * `easeFactor`/`stability`/`difficulty`/`manualLadderIndex` are each meaningful for exactly one
 * algorithm and `null` for the others.
 */
export interface ScheduleState {
  readonly lastReviewedOn: Date;
  readonly intervalDays: number;
  readonly repetitions: number;
  readonly lapses: number;
  readonly easeFactor: number | null;
  readonly stability: number | null;
  readonly difficulty: number | null;
  readonly manualLadderIndex: number | null;
}

/** Settings a `Scheduler` may need. Algorithms ignore whichever fields aren't theirs. */
export interface SchedulerSettings {
  /** Manual algorithm's ladder (FR-8.1 `manualIntervalsJson`); ignored by FSRS/SM-2. */
  readonly manualIntervals: readonly number[];
}

export interface SchedulerInput {
  readonly grade: Grade;
  readonly reviewedOn: Date;
  /** `null` on first review — a topic with no schedule yet. */
  readonly state: ScheduleState | null;
  readonly settings: SchedulerSettings;
}

export interface SchedulerOutput {
  readonly nextReviewOn: Date;
  readonly intervalDays: number;
  readonly state: ScheduleState;
}

/**
 * §8.5's interface, with one deliberate deviation: `id` uses the lower-case values from
 * `packages/shared`'s `Algorithm` union (also `ReviewSchedule.algorithm`'s stored string), not
 * the SRS's illustrative `'FSRS' | 'SM2' | 'MANUAL'` casing — one source of truth for the
 * identifier beats two spellings of the same three strings.
 */
export interface Scheduler {
  readonly id: Algorithm;
  schedule(input: SchedulerInput): SchedulerOutput;
}

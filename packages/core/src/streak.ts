// Streak counter (§2.3 "maintaining streak counters", FR-7.3, delivery-plan.md P9). Pure
// function of already-resolved calendar days — DST and day-start-hour handling both happen one
// layer up (`packages/shared`'s `startOfUserDay`) when the caller turns session instants into
// user-day buckets; this package only ever does whole-day arithmetic on the results (same
// division of responsibility as `date-utils.ts`).
const MS_PER_DAY = 86_400_000;

export interface StreakResult {
  /** Consecutive user-days, ending today or yesterday (today not yet studied), with >= 1 session. */
  readonly currentStreak: number;
  /** The longest such run anywhere in `activeDays`, including the current one. */
  readonly longestStreak: number;
}

/**
 * `activeDays` are the distinct user-day dates (UTC-midnight instants) on which the user logged
 * at least one session; `asOfDate` is the current user-day, in the same representation. A gap of
 * exactly one day back from today (i.e. "not yet studied today") does not break the current
 * streak — it only breaks once a whole day is skipped.
 */
export function computeStreak(activeDays: readonly Date[], asOfDate: Date): StreakResult {
  const uniqueDayTimes = [...new Set(activeDays.map((d) => d.getTime()))].sort((a, b) => b - a);
  if (uniqueDayTimes.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const daySet = new Set(uniqueDayTimes);
  let cursor = asOfDate.getTime();
  if (!daySet.has(cursor)) {
    cursor -= MS_PER_DAY;
  }
  let currentStreak = 0;
  while (daySet.has(cursor)) {
    currentStreak += 1;
    cursor -= MS_PER_DAY;
  }

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < uniqueDayTimes.length; i += 1) {
    const previous = uniqueDayTimes[i - 1];
    const current = uniqueDayTimes[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (previous - current === MS_PER_DAY) {
      run += 1;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
  }
  longestStreak = Math.max(longestStreak, currentStreak);

  return { currentStreak, longestStreak };
}

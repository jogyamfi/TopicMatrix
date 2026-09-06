// Small UTC-instant date helpers for pure day-granularity math. `studiedOn`/`nextReviewOn` are
// always stored as UTC-midnight instants (§6.3) by the time they reach this package, so plain
// millisecond arithmetic is exact and DST-safe — there is no timezone conversion here. Turning a
// user's local day into that UTC instant is `packages/shared/date.ts`'s job, not this package's
// (P3 has zero dependency on wall-clock/timezone concerns; it only ever receives `asOfDate`).
const MS_PER_DAY = 86_400_000;

/** Fractional days from `from` to `to` (positive if `to` is later). */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/** `date` plus a whole number of days, as a UTC instant. */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

import { addDays, startOfUserDay } from '@topicmatrix/shared';

// Date-only values (studiedOn, nextReviewOn, lastReviewedOn, …) travel as UTC-midnight ISO
// instants (§6.3). They name a calendar day, not a moment, so they must be read and formatted in
// UTC: formatting one in the browser's local zone shows the PREVIOUS day anywhere west of UTC.

/** Formats a date-only value (`YYYY-MM-DD` or a UTC-midnight ISO instant) for display. */
export function formatDateOnly(value: string): string {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
  });
}

export interface UserDaySettings {
  timezone: string;
  dayStartHour: number;
}

/**
 * The user's current day as `YYYY-MM-DD` — the same rule the server applies when it stores or
 * validates a `studiedOn` (FR-5.9: the settings timezone, with the day rolling over at
 * `dayStartHour`, not midnight). Without settings (still loading), falls back to the browser's
 * own calendar date.
 */
export function userTodayIsoDate(settings: UserDaySettings | null | undefined, now: Date = new Date()): string {
  if (!settings) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return startOfUserDay(now, settings.timezone, settings.dayStartHour).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` `days` before `isoDate` (calendar arithmetic, never local-time). */
export function isoDateMinusDays(isoDate: string, days: number): string {
  return addDays(new Date(`${isoDate}T00:00:00.000Z`), -days).toISOString().slice(0, 10);
}

import { z } from 'zod';

// IANA timezone identifiers only — validated via Intl rather than a hand-maintained list.
export const timezoneSchema = z.string().refine((tz) => isValidTimezone(tz), {
  message: 'Must be a valid IANA timezone identifier',
});

// Date-only request fields (studiedOn, schedule overrides, history range filters, §6.3) are
// always `YYYY-MM-DD` on the wire, parsed straight to the UTC-midnight storage representation —
// never a full ISO instant, since a date-only field has no meaningful time-of-day component.
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date (YYYY-MM-DD)')
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Reads the wall-clock date/hour that `instant` falls on in `timezone`, DST-safe. */
function partsInTimezone(instant: Date, timezone: string): CalendarDate & { hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const map = new Map(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: Number(map.get('hour')),
  };
}

/** UTC-midnight `Date` for a calendar date — the storage representation for date-only fields (§6.3). */
function toUtcMidnight({ year, month, day }: CalendarDate): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The calendar date `instant` falls on in `timezone`, as a UTC-midnight `Date` (§6.3: date-only
 * fields are stored as UTC midnight and interpreted via the user's timezone in the app layer).
 * No day-start-hour adjustment — use `startOfUserDay` for that.
 */
export function toUserDate(instant: Date, timezone: string): Date {
  const { year, month, day } = partsInTimezone(instant, timezone);
  return toUtcMidnight({ year, month, day });
}

/**
 * The "user day" `instant` belongs to, given the day rolls over at `dayStartHour` local time
 * rather than midnight — a session logged at 01:00 with `dayStartHour = 4` counts toward the
 * previous day (FR-5.9). Returned as a UTC-midnight `Date`, matching `toUserDate`'s storage form.
 */
export function startOfUserDay(instant: Date, timezone: string, dayStartHour: number): Date {
  const parts = partsInTimezone(instant, timezone);
  const calendarDate =
    parts.hour < dayStartHour
      ? shiftCalendarDay({ year: parts.year, month: parts.month, day: parts.day }, -1)
      : { year: parts.year, month: parts.month, day: parts.day };
  return toUtcMidnight(calendarDate);
}

function shiftCalendarDay(date: CalendarDate, deltaDays: number): CalendarDate {
  // JS Date normalises out-of-range day/month components, so this handles month/year rollover.
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + deltaDays));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Adds `days` to a UTC-midnight date-only value. Never operates on wall-clock/local time. */
export function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

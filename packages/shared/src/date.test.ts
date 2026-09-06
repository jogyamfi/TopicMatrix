import { describe, expect, it } from 'vitest';
import { addDays, isValidTimezone, startOfUserDay, toUserDate } from './date.js';

describe('isValidTimezone', () => {
  it('accepts a real IANA identifier', () => {
    expect(isValidTimezone('Europe/London')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidTimezone('Not/A_Zone')).toBe(false);
  });
});

describe('toUserDate', () => {
  it('returns the calendar date in the given timezone as a UTC-midnight Date', () => {
    // 23:30 UTC on Jan 1 is already Jan 2 in Europe/London only during BST; in January it's GMT
    // (UTC+0), so this stays Jan 1 — pick New York (UTC-5) instead to cross a day boundary.
    const instant = new Date('2026-01-02T02:00:00Z'); // 21:00 previous day in America/New_York
    const result = toUserDate(instant, 'America/New_York');
    expect(result.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('matches the UTC calendar date when timezone is UTC', () => {
    const instant = new Date('2026-06-15T13:45:00Z');
    expect(toUserDate(instant, 'UTC').toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('startOfUserDay', () => {
  it('keeps the same calendar day when local hour is at or after dayStartHour', () => {
    const instant = new Date('2026-03-10T10:00:00Z'); // 10:00 UTC, dayStartHour=4
    expect(startOfUserDay(instant, 'UTC', 4).toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('rolls back to the previous day when local hour is before dayStartHour', () => {
    const instant = new Date('2026-03-10T01:00:00Z'); // 01:00 UTC < dayStartHour=4
    expect(startOfUserDay(instant, 'UTC', 4).toISOString()).toBe('2026-03-09T00:00:00.000Z');
  });

  it('rolls over month and year boundaries correctly', () => {
    const instant = new Date('2026-01-01T02:00:00Z');
    expect(startOfUserDay(instant, 'UTC', 4).toISOString()).toBe('2025-12-31T00:00:00.000Z');
  });
});

describe('addDays', () => {
  it('adds whole days to a UTC-midnight date', () => {
    const date = new Date('2026-09-05T00:00:00.000Z');
    expect(addDays(date, 3).toISOString()).toBe('2026-09-08T00:00:00.000Z');
  });

  it('subtracts days with a negative delta', () => {
    const date = new Date('2026-09-05T00:00:00.000Z');
    expect(addDays(date, -5).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});

describe('DST round-trip (Europe/London, clocks back last Sunday of October 2026)', () => {
  it('advances the calendar date by exactly one day across the DST boundary', () => {
    // 20:00 UTC on the 24th (21:00 BST local) and 20:00 UTC on the 25th (20:00 GMT local, after
    // the fall-back at 01:00 UTC) are exactly 24h apart in real time but the UTC offset changes
    // mid-way. Date-only handling must still see this as "the next calendar day", not a skip
    // or repeat, because it never relies on a fixed UTC offset.
    const before = new Date('2026-10-24T20:00:00Z');
    const after = new Date('2026-10-25T20:00:00Z');

    const dayBefore = startOfUserDay(before, 'Europe/London', 4);
    const dayAfter = startOfUserDay(after, 'Europe/London', 4);

    expect(addDays(dayBefore, 1).toISOString()).toBe(dayAfter.toISOString());
    expect(dayBefore.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(dayAfter.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('a session logged just after local midnight but before dayStartHour still counts as the prior day, spanning the transition', () => {
    // 01:30 local time on the 25th (GMT, post-transition) with dayStartHour=4 must roll back to
    // the 24th, exactly as it would on any other day.
    const instant = new Date('2026-10-25T01:30:00Z');
    expect(startOfUserDay(instant, 'Europe/London', 4).toISOString()).toBe(
      '2026-10-24T00:00:00.000Z',
    );
  });
});

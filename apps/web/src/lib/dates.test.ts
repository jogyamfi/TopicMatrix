import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateOnly, isoDateMinusDays, userTodayIsoDate } from './dates';

describe('formatDateOnly', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the stored calendar day even in a timezone west of UTC', () => {
    // A UTC-midnight value is the previous evening in Los Angeles — formatting it in local time
    // (the old behaviour) would show 25 September.
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const formatted = formatDateOnly('2026-09-26T00:00:00.000Z');
    expect(formatted).toBe(new Date(Date.UTC(2026, 8, 26)).toLocaleDateString(undefined, { timeZone: 'UTC' }));
    expect(formatted).toContain('26');
  });

  it('accepts a bare YYYY-MM-DD', () => {
    expect(formatDateOnly('2026-01-05')).toBe(formatDateOnly('2026-01-05T00:00:00.000Z'));
  });
});

describe('userTodayIsoDate', () => {
  const london = { timezone: 'Europe/London', dayStartHour: 4 };

  it('is still yesterday before dayStartHour (FR-5.9)', () => {
    // 01:30 BST on 26 Sep = 00:30 UTC.
    expect(userTodayIsoDate(london, new Date('2026-09-26T00:30:00.000Z'))).toBe('2026-09-25');
  });

  it('rolls over at dayStartHour', () => {
    // 04:30 BST on 26 Sep = 03:30 UTC.
    expect(userTodayIsoDate(london, new Date('2026-09-26T03:30:00.000Z'))).toBe('2026-09-26');
  });

  it('uses the settings timezone, not UTC', () => {
    // 08:00 on 26 Sep in Tokyo is still 25 Sep in UTC.
    const tokyo = { timezone: 'Asia/Tokyo', dayStartHour: 0 };
    expect(userTodayIsoDate(tokyo, new Date('2026-09-25T23:00:00.000Z'))).toBe('2026-09-26');
  });
});

describe('isoDateMinusDays', () => {
  it('does calendar arithmetic across month boundaries', () => {
    expect(isoDateMinusDays('2026-03-01', 1)).toBe('2026-02-28');
    expect(isoDateMinusDays('2026-09-26', 30)).toBe('2026-08-27');
  });
});

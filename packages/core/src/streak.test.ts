import { describe, expect, it } from 'vitest';
import { computeStreak } from './streak.js';

const MS_PER_DAY = 86_400_000;
const day = (n: number): Date => new Date(Date.UTC(2026, 0, 1 + n));

describe('computeStreak (FR-7.3)', () => {
  it('returns zero for no active days', () => {
    expect(computeStreak([], day(10))).toEqual({ currentStreak: 0, longestStreak: 0 });
  });

  it('counts a single day studied today as a streak of 1', () => {
    expect(computeStreak([day(10)], day(10))).toEqual({ currentStreak: 1, longestStreak: 1 });
  });

  it('counts consecutive days ending today', () => {
    const active = [day(8), day(9), day(10)];
    expect(computeStreak(active, day(10))).toEqual({ currentStreak: 3, longestStreak: 3 });
  });

  it('does not break the current streak when today has no session yet', () => {
    const active = [day(7), day(8), day(9)];
    expect(computeStreak(active, day(10))).toEqual({ currentStreak: 3, longestStreak: 3 });
  });

  it('breaks the current streak once a whole day is skipped', () => {
    const active = [day(5), day(6), day(9), day(10)];
    expect(computeStreak(active, day(10))).toEqual({ currentStreak: 2, longestStreak: 2 });
  });

  it('reports the longest historical streak even if the current one is shorter', () => {
    const active = [day(1), day(2), day(3), day(4), day(9)];
    expect(computeStreak(active, day(10))).toEqual({ currentStreak: 1, longestStreak: 4 });
  });

  it('deduplicates multiple sessions on the same day', () => {
    const active = [day(10), day(10), day(9)];
    expect(computeStreak(active, day(10))).toEqual({ currentStreak: 2, longestStreak: 2 });
  });

  it('is unaffected by DST transitions, since inputs are already UTC-midnight user-day buckets', () => {
    // A DST spring-forward/fall-back boundary in the user's timezone never changes the UTC
    // millisecond gap between two consecutive user-day buckets (`startOfUserDay`'s job, one
    // layer up) — this package only ever sees whole `MS_PER_DAY` gaps.
    const active = [day(0), day(1), day(2)];
    expect(computeStreak(active, day(2)).currentStreak).toBe(3);
    expect(day(1).getTime() - day(0).getTime()).toBe(MS_PER_DAY);
  });
});

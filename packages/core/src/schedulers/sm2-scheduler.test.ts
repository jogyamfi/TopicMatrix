import { describe, expect, it } from 'vitest';
import { sm2Scheduler, SM2_EASE_FACTOR_FLOOR, SM2_INITIAL_EASE_FACTOR } from './sm2-scheduler.js';
import type { ScheduleState, SchedulerSettings } from '../types.js';

const settings: SchedulerSettings = { manualIntervals: [] };
const reviewedOn = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

// Published worked example (classic SuperMemo-2 table): a run of quality-4 ("Good", grade 3)
// responses keeps EF unchanged at 2.5 and produces the textbook interval sequence 1, 6, 15, 38...
describe('sm2Scheduler — published worked example (all "Good")', () => {
  it('keeps EF at 2.5 and produces the classic 1/6/round(prev*EF) interval sequence', () => {
    let state: ScheduleState | null = null;
    const intervals: number[] = [];
    const easeFactors: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      const output = sm2Scheduler.schedule({
        grade: 3,
        reviewedOn: reviewedOn(i),
        state,
        settings,
      });
      state = output.state;
      intervals.push(output.intervalDays);
      easeFactors.push(output.state.easeFactor as number);
    }

    expect(easeFactors.every((ef) => ef === SM2_INITIAL_EASE_FACTOR)).toBe(true);
    expect(intervals[0]).toBe(1);
    expect(intervals[1]).toBe(6);
    expect(intervals[2]).toBe(Math.round(6 * SM2_INITIAL_EASE_FACTOR)); // 15
    expect(intervals[3]).toBe(Math.round((intervals[2] as number) * SM2_INITIAL_EASE_FACTOR));
  });
});

describe('sm2Scheduler — lapse handling', () => {
  it('resets repetitions to 0 and interval to 1 day, and increments lapses, on grade 1', () => {
    const afterGood = sm2Scheduler.schedule({
      grade: 3,
      reviewedOn: reviewedOn(0),
      state: null,
      settings,
    });
    const afterGood2 = sm2Scheduler.schedule({
      grade: 3,
      reviewedOn: reviewedOn(1),
      state: afterGood.state,
      settings,
    });

    const afterLapse = sm2Scheduler.schedule({
      grade: 1,
      reviewedOn: reviewedOn(2),
      state: afterGood2.state,
      settings,
    });

    expect(afterLapse.state.repetitions).toBe(0);
    expect(afterLapse.intervalDays).toBe(1);
    expect(afterLapse.state.lapses).toBe(1);
  });

  it('still updates EF on a lapse (per the classic formula), floored at 1.3', () => {
    let state: ScheduleState | null = null;
    for (let i = 0; i < 20; i += 1) {
      const output = sm2Scheduler.schedule({
        grade: 1,
        reviewedOn: reviewedOn(i),
        state,
        settings,
      });
      state = output.state;
    }
    expect(state?.easeFactor).toBe(SM2_EASE_FACTOR_FLOOR);
  });
});

describe('sm2Scheduler — grade to quality mapping', () => {
  it('leaves easeFactor unchanged only for grade 3 (quality 4); other grades shift it', () => {
    const grade2 = sm2Scheduler.schedule({ grade: 2, reviewedOn: reviewedOn(0), state: null, settings });
    const grade4 = sm2Scheduler.schedule({ grade: 4, reviewedOn: reviewedOn(0), state: null, settings });

    expect(grade2.state.easeFactor).toBeLessThan(SM2_INITIAL_EASE_FACTOR);
    expect(grade4.state.easeFactor).toBeGreaterThan(SM2_INITIAL_EASE_FACTOR);
  });
});

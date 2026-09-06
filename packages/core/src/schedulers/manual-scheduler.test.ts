import { describe, expect, it } from 'vitest';
import { manualScheduler } from './manual-scheduler.js';
import type { ScheduleState, SchedulerSettings } from '../types.js';

const reviewedOn = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

describe('manualScheduler', () => {
  it('uses the default ladder when settings provide none', () => {
    const settings: SchedulerSettings = { manualIntervals: [] };
    const output = manualScheduler.schedule({ grade: 3, reviewedOn: reviewedOn(0), state: null, settings });
    expect(output.intervalDays).toBe(1); // DEFAULT_MANUAL_INTERVALS[0]
  });

  it('advances one rung per grade >= 2 review, capped at the last rung', () => {
    const settings: SchedulerSettings = { manualIntervals: [1, 3, 7] };
    let state: ScheduleState | null = null;
    const intervals: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      const output = manualScheduler.schedule({ grade: 3, reviewedOn: reviewedOn(i), state, settings });
      state = output.state;
      intervals.push(output.intervalDays);
    }

    expect(intervals).toEqual([1, 3, 7, 7, 7]); // capped once the ladder runs out
  });

  it('resets to rung 0 on grade 1, and increments lapses', () => {
    const settings: SchedulerSettings = { manualIntervals: [1, 3, 7, 14] };
    const rung0 = manualScheduler.schedule({ grade: 3, reviewedOn: reviewedOn(0), state: null, settings });
    const rung1 = manualScheduler.schedule({
      grade: 3,
      reviewedOn: reviewedOn(1),
      state: rung0.state,
      settings,
    });
    expect(rung1.intervalDays).toBe(3);

    const lapsed = manualScheduler.schedule({
      grade: 1,
      reviewedOn: reviewedOn(2),
      state: rung1.state,
      settings,
    });
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.state.manualLadderIndex).toBe(0);
    expect(lapsed.state.lapses).toBe(1);
  });

  it('increments repetitions on every review regardless of grade', () => {
    const settings: SchedulerSettings = { manualIntervals: [1, 3] };
    const first = manualScheduler.schedule({ grade: 1, reviewedOn: reviewedOn(0), state: null, settings });
    expect(first.state.repetitions).toBe(1);
    const second = manualScheduler.schedule({
      grade: 3,
      reviewedOn: reviewedOn(1),
      state: first.state,
      settings,
    });
    expect(second.state.repetitions).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { manualScheduler } from './schedulers/manual-scheduler.js';
import { sm2Scheduler } from './schedulers/sm2-scheduler.js';
import { fsrsScheduler } from './schedulers/registry.js';
import { replaySchedule, resolveSessionGrade, type ReplaySessionInput } from './replay.js';
import type { Scheduler, SchedulerSettings } from './types.js';

const settings: SchedulerSettings = { manualIntervals: [1, 3, 7, 14, 30, 60] };
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

const sessions: ReplaySessionInput[] = [
  { studiedOn: day(0), accuracy: 0.9, confidence: 4, gradeUsed: null },
  { studiedOn: day(3), accuracy: 0.4, confidence: 2, gradeUsed: null },
  { studiedOn: day(10), accuracy: 1, confidence: 5, gradeUsed: 4 }, // explicit override
  { studiedOn: day(20), accuracy: 0.6, confidence: 3, gradeUsed: null },
];

const schedulers: Record<string, Scheduler> = {
  fsrs: fsrsScheduler,
  sm2: sm2Scheduler,
  manual: manualScheduler,
};

describe('resolveSessionGrade', () => {
  it('prefers the persisted gradeUsed override over the computed grade', () => {
    expect(resolveSessionGrade({ accuracy: 0, confidence: 1, gradeUsed: 4 })).toBe(4);
  });
  it('falls back to computeGrade when gradeUsed is null', () => {
    expect(resolveSessionGrade({ accuracy: 1, confidence: 5, gradeUsed: null })).toBe(4);
  });
});

describe('replaySchedule', () => {
  it('returns null for no sessions', () => {
    expect(replaySchedule([], fsrsScheduler, settings)).toBeNull();
  });

  for (const [name, scheduler] of Object.entries(schedulers)) {
    describe(`with ${name}`, () => {
      it('is order-independent: sessions given out of chronological order replay the same', () => {
        const inOrder = replaySchedule(sessions, scheduler, settings);
        const shuffled = replaySchedule([...sessions].reverse(), scheduler, settings);
        expect(shuffled).toEqual(inOrder);
      });

      it('is idempotent: replaying the same sessions twice gives the same result', () => {
        const first = replaySchedule(sessions, scheduler, settings);
        const second = replaySchedule(sessions, scheduler, settings);
        expect(second).toEqual(first);
      });

      it('replaying a prefix then folding in the remainder equals replaying the whole history', () => {
        const whole = replaySchedule(sessions, scheduler, settings);

        const prefix = sessions.slice(0, 2);
        const remainder = sessions.slice(2);
        const prefixOutput = replaySchedule(prefix, scheduler, settings);

        let state = prefixOutput?.state ?? null;
        let output = prefixOutput;
        const chronologicalRemainder = [...remainder].sort(
          (a, b) => a.studiedOn.getTime() - b.studiedOn.getTime(),
        );
        for (const session of chronologicalRemainder) {
          output = scheduler.schedule({
            grade: resolveSessionGrade(session),
            reviewedOn: session.studiedOn,
            state,
            settings,
          });
          state = output.state;
        }

        expect(output).toEqual(whole);
      });
    });
  }
});

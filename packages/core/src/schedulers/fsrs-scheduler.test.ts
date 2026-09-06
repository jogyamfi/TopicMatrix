// Verifies fsrsScheduler against `ts-fsrs`'s own output directly, using identical parameters
// (request_retention 0.9, enable_short_term/enable_fuzz false — see fsrs-scheduler.ts) run
// through the same grade sequence. This is the practical form "verified against ts-fsrs's own
// fixtures" takes for a thin wrapper: the risk P3 needs to guard against is the wrapper silently
// diverging from the library (wrong field mapping, wrong rounding, wrong reconstructed Card),
// not re-deriving FSRS's own published parameters by hand.
import { createEmptyCard, fsrs, type Card, type Grade as FsrsGrade } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { fsrsScheduler, FSRS_REQUESTED_RETENTION } from './fsrs-scheduler.js';
import type { ScheduleState, SchedulerSettings } from '../types.js';

const settings: SchedulerSettings = { manualIntervals: [] };
const reviewedOn = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

const referenceEngine = fsrs({
  request_retention: FSRS_REQUESTED_RETENTION,
  enable_short_term: false,
  enable_fuzz: false,
});

describe('fsrsScheduler — consistency with a direct ts-fsrs call', () => {
  const grades: Array<1 | 2 | 3 | 4> = [3, 3, 1, 4, 2, 3];

  it('matches stability/difficulty/interval at every step of a mixed-grade sequence', () => {
    let wrapperState: ScheduleState | null = null;
    let referenceCard: Card = createEmptyCard();

    grades.forEach((grade, i) => {
      const day = reviewedOn(i);

      const wrapperOutput = fsrsScheduler.schedule({
        grade,
        reviewedOn: day,
        state: wrapperState,
        settings,
      });
      wrapperState = wrapperOutput.state;

      const { card: nextReferenceCard } = referenceEngine.next(
        referenceCard,
        day,
        grade as unknown as FsrsGrade,
      );
      referenceCard = nextReferenceCard;

      expect(wrapperOutput.state.stability).toBeCloseTo(referenceCard.stability, 9);
      expect(wrapperOutput.state.difficulty).toBeCloseTo(referenceCard.difficulty, 9);
      expect(wrapperOutput.intervalDays).toBe(Math.max(1, Math.round(referenceCard.scheduled_days)));
      expect(wrapperOutput.state.repetitions).toBe(referenceCard.reps);
      expect(wrapperOutput.state.lapses).toBe(referenceCard.lapses);
    });
  });
});

describe('fsrsScheduler — general behaviour', () => {
  it('produces a longer interval after repeated "Easy" ratings than after repeated "Again" ratings', () => {
    let easyState: ScheduleState | null = null;
    let againState: ScheduleState | null = null;
    let easyOutput = fsrsScheduler.schedule({ grade: 4, reviewedOn: reviewedOn(0), state: null, settings });
    let againOutput = fsrsScheduler.schedule({ grade: 1, reviewedOn: reviewedOn(0), state: null, settings });

    for (let i = 1; i < 4; i += 1) {
      easyState = easyOutput.state;
      againState = againOutput.state;
      easyOutput = fsrsScheduler.schedule({ grade: 4, reviewedOn: reviewedOn(i), state: easyState, settings });
      againOutput = fsrsScheduler.schedule({ grade: 1, reviewedOn: reviewedOn(i), state: againState, settings });
    }

    expect(easyOutput.intervalDays).toBeGreaterThan(againOutput.intervalDays);
  });

  it('never schedules an interval shorter than 1 day (date-only granularity)', () => {
    const output = fsrsScheduler.schedule({ grade: 1, reviewedOn: reviewedOn(0), state: null, settings });
    expect(output.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic: the same input always produces the same output', () => {
    const a = fsrsScheduler.schedule({ grade: 3, reviewedOn: reviewedOn(0), state: null, settings });
    const b = fsrsScheduler.schedule({ grade: 3, reviewedOn: reviewedOn(0), state: null, settings });
    expect(a).toEqual(b);
  });
});

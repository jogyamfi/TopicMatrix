import { describe, expect, it } from 'vitest';
import { fsrsScheduler, getScheduler, manualScheduler, sm2Scheduler } from './registry.js';

describe('getScheduler', () => {
  it('resolves each algorithm id to its scheduler (FR-5.8)', () => {
    expect(getScheduler('fsrs')).toBe(fsrsScheduler);
    expect(getScheduler('sm2')).toBe(sm2Scheduler);
    expect(getScheduler('manual')).toBe(manualScheduler);
  });
});

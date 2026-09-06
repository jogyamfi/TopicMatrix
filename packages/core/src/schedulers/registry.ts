// Scheduler registry (§8.5, FR-5.8) — adding an algorithm means one implementation plus one
// entry here; no call site elsewhere needs to change.
import type { Algorithm } from '@topicmatrix/shared';
import { fsrsScheduler } from './fsrs-scheduler.js';
import { manualScheduler } from './manual-scheduler.js';
import { sm2Scheduler } from './sm2-scheduler.js';
import type { Scheduler } from '../types.js';

export const schedulerRegistry: Readonly<Record<Algorithm, Scheduler>> = {
  fsrs: fsrsScheduler,
  sm2: sm2Scheduler,
  manual: manualScheduler,
};

export function getScheduler(id: Algorithm): Scheduler {
  return schedulerRegistry[id];
}

export { fsrsScheduler } from './fsrs-scheduler.js';
export { manualScheduler } from './manual-scheduler.js';
export { sm2Scheduler } from './sm2-scheduler.js';

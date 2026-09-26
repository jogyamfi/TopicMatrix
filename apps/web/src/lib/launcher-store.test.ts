import { describe, expect, it } from 'vitest';
import type { ReviewQueueItem } from '@topicmatrix/shared';
import { advanceLauncherRun, startLauncherRun, summariseLauncherRun } from './launcher-store';

function item(topicId: string): ReviewQueueItem {
  return {
    topicId,
    subjectId: 's1',
    subjectName: 'Maths',
    name: topicId,
    notes: null,
    score: 50,
    healthStatus: 'needsReview',
    lastReviewedOn: null,
    nextReviewOn: null,
    overdueDays: 0,
    accuracyTrend: null,
  };
}

describe('launcher run outcomes (R3)', () => {
  it('records each outcome and summarises logged/skipped/snoozed with question-weighted accuracy', () => {
    let run = startLauncherRun('u1', [item('a'), item('b'), item('c'), item('d')]);
    run = advanceLauncherRun(run, { kind: 'logged', questionsAttempted: 10, questionsCorrect: 9 });
    run = advanceLauncherRun(run, { kind: 'skipped' });
    run = advanceLauncherRun(run, { kind: 'logged', questionsAttempted: 30, questionsCorrect: 15 });
    run = advanceLauncherRun(run, { kind: 'snoozed', days: 3 });

    const summary = summariseLauncherRun(run);
    expect(summary).toMatchObject({ logged: 2, skipped: 1, snoozed: 1 });
    // (9 + 15) / (10 + 30), not the mean of 90% and 50%.
    expect(summary.accuracy).toBeCloseTo(0.6);
    expect(summary.skippedItems.map((i) => i.topicId)).toEqual(['b']);
  });

  it('reports no accuracy when nothing was logged', () => {
    let run = startLauncherRun('u1', [item('a')]);
    run = advanceLauncherRun(run, { kind: 'skipped' });
    expect(summariseLauncherRun(run).accuracy).toBeNull();
  });
});

// Replay (§8.6) — the schedule for a topic is always derived by folding its full session history,
// chronologically, through the scheduler from a null initial state. This is what keeps a stored
// schedule consistent after back-dated (FR-4.7) or edited/deleted (FR-4.4) sessions: recompute it
// from scratch rather than patch it incrementally.
import { computeGrade } from './grade.js';
import type { Grade, Scheduler, SchedulerSettings, SchedulerOutput } from './types.js';

export interface ReplaySessionInput {
  readonly studiedOn: Date;
  readonly accuracy: number;
  readonly confidence: number;
  /** `StudySession.gradeUsed` — the grade actually applied, which may differ from the computed one (FR-5.4). */
  readonly gradeUsed: Grade | null;
}

/** The grade a session contributes to scheduling: the persisted override, or the computed one. */
export function resolveSessionGrade(
  session: Pick<ReplaySessionInput, 'accuracy' | 'confidence' | 'gradeUsed'>,
): Grade {
  return session.gradeUsed ?? computeGrade(session.accuracy, session.confidence);
}

/**
 * Folds `sessions` in chronological order through `scheduler`, starting from a null state.
 * Returns `null` if there are no sessions (no schedule exists yet). Deterministic and idempotent:
 * replaying the same sessions twice gives the same result, and replaying a prefix then folding in
 * the remainder gives the same result as replaying the whole history in one call.
 */
export function replaySchedule(
  sessions: readonly ReplaySessionInput[],
  scheduler: Scheduler,
  settings: SchedulerSettings,
): SchedulerOutput | null {
  const chronological = [...sessions].sort((a, b) => a.studiedOn.getTime() - b.studiedOn.getTime());

  let output: SchedulerOutput | null = null;
  for (const session of chronological) {
    output = scheduler.schedule({
      grade: resolveSessionGrade(session),
      reviewedOn: session.studiedOn,
      state: output?.state ?? null,
      settings,
    });
  }
  return output;
}

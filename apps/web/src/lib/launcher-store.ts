import type { ReviewQueueItem } from '@topicmatrix/shared';

/**
 * Client-side-only launcher run persistence (FR-6.5) — a page refresh mid-session must resume at
 * the same item, and NF-15 forbids relying on server-side in-process state for this, so the
 * ordered item list + current index live in `localStorage` rather than anywhere on the server.
 * The snapshot taken at `POST /review/start` time (score, accuracy trend, next-due date) is what
 * the launcher displays throughout the run — it doesn't refetch mid-run, since acting on an item
 * (log/skip/snooze) always advances past it anyway.
 *
 * A run records the user it belongs to and is only ever loaded for that same user, so a shared
 * browser never shows one account's topics to another; auth-store also clears it whenever the
 * signed-in user changes.
 */

/** What happened to one item of the run (R3: the completion summary reports these). */
export type LauncherOutcome =
  | { readonly kind: 'logged'; readonly questionsAttempted: number; readonly questionsCorrect: number }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'snoozed'; readonly days: number };

export interface LauncherRun {
  readonly userId: string;
  readonly items: readonly ReviewQueueItem[];
  readonly index: number;
  readonly startedAt: string;
  /** By topic id, for every item acted on so far. */
  readonly outcomes: Readonly<Record<string, LauncherOutcome>>;
}

const STORAGE_KEY = 'topicmatrix:launcher-run';

// localStorage can throw (private mode, blocked site data, quota) — a lost run is an
// inconvenience, never a crash.
function saveLauncherRun(run: LauncherRun): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
  } catch {
    // Run stays in memory for this page view only.
  }
}

export function loadLauncherRun(userId: string): LauncherRun | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LauncherRun>;
    if (parsed.userId !== userId || !Array.isArray(parsed.items) || typeof parsed.index !== 'number') {
      return null;
    }
    // Runs saved before outcomes were tracked have none; they resume with an empty record.
    return { ...(parsed as LauncherRun), outcomes: parsed.outcomes ?? {} };
  } catch {
    return null;
  }
}

export function clearLauncherRun(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function startLauncherRun(userId: string, items: readonly ReviewQueueItem[]): LauncherRun {
  const run: LauncherRun = { userId, items, index: 0, startedAt: new Date().toISOString(), outcomes: {} };
  saveLauncherRun(run);
  return run;
}

/** Records what happened to the current item and moves on to the next. */
export function advanceLauncherRun(run: LauncherRun, outcome: LauncherOutcome): LauncherRun {
  const current = run.items[run.index];
  const next: LauncherRun = {
    ...run,
    index: run.index + 1,
    outcomes: current ? { ...run.outcomes, [current.topicId]: outcome } : run.outcomes,
  };
  saveLauncherRun(next);
  return next;
}

export interface LauncherSummary {
  readonly logged: number;
  readonly skipped: number;
  readonly snoozed: number;
  /** Across every logged session, weighted by questions attempted; null if none were logged. */
  readonly accuracy: number | null;
  readonly skippedItems: readonly ReviewQueueItem[];
}

export function summariseLauncherRun(run: LauncherRun): LauncherSummary {
  let logged = 0;
  let skipped = 0;
  let snoozed = 0;
  let attempted = 0;
  let correct = 0;
  const skippedItems: ReviewQueueItem[] = [];
  for (const item of run.items) {
    const outcome = run.outcomes[item.topicId];
    if (!outcome) continue;
    if (outcome.kind === 'logged') {
      logged += 1;
      attempted += outcome.questionsAttempted;
      correct += outcome.questionsCorrect;
    } else if (outcome.kind === 'skipped') {
      skipped += 1;
      skippedItems.push(item);
    } else {
      snoozed += 1;
    }
  }
  return { logged, skipped, snoozed, accuracy: attempted > 0 ? correct / attempted : null, skippedItems };
}

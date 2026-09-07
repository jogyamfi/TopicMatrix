import type { ReviewQueueItem } from '@topicmatrix/shared';

/**
 * Client-side-only launcher run persistence (FR-6.5) \u2014 a page refresh mid-session must resume at
 * the same item, and NF-15 forbids relying on server-side in-process state for this, so the
 * ordered item list + current index live in `localStorage` rather than anywhere on the server.
 * The snapshot taken at `POST /review/start` time (score, accuracy trend, next-due date) is what
 * the launcher displays throughout the run \u2014 it doesn't refetch mid-run, since acting on an item
 * (log/skip/snooze) always advances past it anyway.
 */
export interface LauncherRun {
  readonly items: readonly ReviewQueueItem[];
  readonly index: number;
  readonly startedAt: string;
}

const STORAGE_KEY = 'topicmatrix:launcher-run';

export function saveLauncherRun(run: LauncherRun): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
}

export function loadLauncherRun(): LauncherRun | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LauncherRun;
    if (!Array.isArray(parsed.items) || typeof parsed.index !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLauncherRun(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function startLauncherRun(items: readonly ReviewQueueItem[]): LauncherRun {
  const run: LauncherRun = { items, index: 0, startedAt: new Date().toISOString() };
  saveLauncherRun(run);
  return run;
}

export function advanceLauncherRun(run: LauncherRun): LauncherRun {
  const next: LauncherRun = { ...run, index: run.index + 1 };
  saveLauncherRun(next);
  return next;
}

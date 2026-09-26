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
export interface LauncherRun {
  readonly userId: string;
  readonly items: readonly ReviewQueueItem[];
  readonly index: number;
  readonly startedAt: string;
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
    const parsed = JSON.parse(raw) as LauncherRun;
    if (parsed.userId !== userId || !Array.isArray(parsed.items) || typeof parsed.index !== 'number') {
      return null;
    }
    return parsed;
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
  const run: LauncherRun = { userId, items, index: 0, startedAt: new Date().toISOString() };
  saveLauncherRun(run);
  return run;
}

export function advanceLauncherRun(run: LauncherRun): LauncherRun {
  const next: LauncherRun = { ...run, index: run.index + 1 };
  saveLauncherRun(next);
  return next;
}

import { z } from 'zod';

// Enum-like fields are plain `String` columns in Prisma (SQLite has no enum type, §6.3) plus
// these Zod schemas / TS unions as the single source of truth for validation and typing.

export const roleSchema = z.enum(['ADMIN', 'LEARNER']);
export type Role = z.infer<typeof roleSchema>;

export const algorithmSchema = z.enum(['fsrs', 'sm2', 'manual']);
export type Algorithm = z.infer<typeof algorithmSchema>;

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const topicDeleteModeSchema = z.enum(['cascade', 'promote']);
export type TopicDeleteMode = z.infer<typeof topicDeleteModeSchema>;

// Mirrors packages/core's HealthStatus union (§7.4) — health is never colour-only (NF-4), so the
// web app pairs every one of these with an icon + text label (HealthStatusBadge, P6).
export const healthStatusSchema = z.enum(['notStarted', 'strong', 'needsReview', 'atRisk']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const DEFAULT_MANUAL_INTERVALS = [1, 3, 7, 14, 30, 60] as const;

export const manualIntervalsSchema = z.array(z.number().int().positive()).min(1);
export type ManualIntervals = z.infer<typeof manualIntervalsSchema>;

/** `manualIntervalsJson` has no `Json` column type available (§6.3) — stored as a `String`. */
export function parseManualIntervals(json: string): ManualIntervals {
  return manualIntervalsSchema.parse(JSON.parse(json));
}

export function stringifyManualIntervals(intervals: ManualIntervals): string {
  return JSON.stringify(manualIntervalsSchema.parse(intervals));
}

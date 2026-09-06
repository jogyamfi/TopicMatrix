import { z } from 'zod';
import { dateOnlySchema } from './date.js';
import { algorithmSchema } from './domain.js';

// POST /topics/:id/schedule/override (FR-5.6, FR-5.10) — explicit next-review date, snooze by
// n days, or suspend/unsuspend. A discriminated union so each action's payload is exactly what
// it needs, nothing more.
export const scheduleOverrideRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setNextReviewOn'), nextReviewOn: dateOnlySchema }),
  z.object({ action: z.literal('snooze'), days: z.number().int().positive() }),
  z.object({ action: z.literal('suspend'), suspended: z.boolean() }),
]);
export type ScheduleOverrideRequest = z.infer<typeof scheduleOverrideRequestSchema>;

// Response shapes (P7) — mirrors packages/api-core/src/routes/sessions.ts's toScheduleView.
export const reviewScheduleViewSchema = z.object({
  topicId: z.string(),
  algorithm: algorithmSchema,
  lastReviewedOn: z.string().nullable(),
  nextReviewOn: z.string().nullable(),
  intervalDays: z.number().nullable(),
  repetitions: z.number(),
  lapses: z.number(),
  easeFactor: z.number().nullable(),
  stability: z.number().nullable(),
  difficulty: z.number().nullable(),
  manualLadderIndex: z.number().nullable(),
  isSuspended: z.boolean(),
});
export type ReviewScheduleView = z.infer<typeof reviewScheduleViewSchema>;

export const scheduleOverrideResponseSchema = z.object({
  status: z.string(),
  schedule: reviewScheduleViewSchema.nullable(),
});
export type ScheduleOverrideResponse = z.infer<typeof scheduleOverrideResponseSchema>;

// GET /topics/:id/schedule (P7) — a standalone schedule read, deferred at P5 pending a real
// consumer; the topic detail page (P7 task 8) is the first one.
export const scheduleResponseSchema = z.object({ schedule: reviewScheduleViewSchema.nullable() });
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;

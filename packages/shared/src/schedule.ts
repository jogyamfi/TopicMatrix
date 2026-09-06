import { z } from 'zod';
import { dateOnlySchema } from './date.js';

// POST /topics/:id/schedule/override (FR-5.6, FR-5.10) \u2014 explicit next-review date, snooze by
// n days, or suspend/unsuspend. A discriminated union so each action's payload is exactly what
// it needs, nothing more.
export const scheduleOverrideRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setNextReviewOn'), nextReviewOn: dateOnlySchema }),
  z.object({ action: z.literal('snooze'), days: z.number().int().positive() }),
  z.object({ action: z.literal('suspend'), suspended: z.boolean() }),
]);
export type ScheduleOverrideRequest = z.infer<typeof scheduleOverrideRequestSchema>;

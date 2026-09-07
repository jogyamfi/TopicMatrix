import { z } from 'zod';
import { healthStatusSchema } from './domain.js';

// Response item shared by GET /review/queue and POST /review/start (delivery-plan.md P8,
// FR-6.*, FR-7.1) \u2014 mirrors packages/db/src/review-queue.ts's ReviewQueueItem.
export const reviewQueueItemSchema = z.object({
  topicId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  name: z.string(),
  notes: z.string().nullable(),
  score: z.number().nullable(),
  healthStatus: healthStatusSchema,
  lastReviewedOn: z.string().nullable(),
  nextReviewOn: z.string().nullable(),
  overdueDays: z.number(),
  accuracyTrend: z.enum(['up', 'down', 'flat']).nullable(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

// GET /review/queue (FR-7.1).
export const reviewQueueResponseSchema = z.object({
  overdue: z.array(reviewQueueItemSchema),
  dueToday: z.array(reviewQueueItemSchema),
  dueNext7Days: z.array(reviewQueueItemSchema),
});
export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>;

// POST /review/start (FR-6.1, FR-6.2, FR-6.4). A flat schema (rather than a discriminated union
// on `mode`) because the secondary filters apply identically regardless of the primary mode;
// the two `.refine`s below cover the per-mode required-field checks a discriminated union would
// otherwise have given for free.
export const reviewStartRequestSchema = z
  .object({
    mode: z.enum(['subject', 'topicSubtree', 'dueToday', 'weakest']),
    subjectId: z.string().min(1).optional(),
    topicId: z.string().min(1).optional(),
    tagId: z.string().min(1).optional(),
    healthStatus: healthStatusSchema.optional(),
    notReviewedInDays: z.number().int().positive().optional(),
    minScore: z.number().min(0).max(100).optional(),
    maxScore: z.number().min(0).max(100).optional(),
    maxItems: z.number().int().positive().optional(),
    targetMinutes: z.number().int().positive().optional(),
  })
  .refine((v) => v.mode !== 'subject' || v.subjectId !== undefined, {
    message: 'subjectId is required when mode is "subject"',
    path: ['subjectId'],
  })
  .refine((v) => v.mode !== 'topicSubtree' || v.topicId !== undefined, {
    message: 'topicId is required when mode is "topicSubtree"',
    path: ['topicId'],
  });
export type ReviewStartRequest = z.infer<typeof reviewStartRequestSchema>;

export const reviewStartResponseSchema = z.object({ items: z.array(reviewQueueItemSchema) });
export type ReviewStartResponse = z.infer<typeof reviewStartResponseSchema>;

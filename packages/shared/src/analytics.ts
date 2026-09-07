import { z } from 'zod';
import { healthStatusSchema } from './domain.js';

// Shared response contracts for /analytics/* (delivery-plan.md P9, FR-7.2\u2013FR-7.9). Mirrors
// packages/db/src/analytics.ts's return types.

export const dashboardTodaySummarySchema = z.object({
  topicsReviewed: z.number(),
  questionsAttempted: z.number(),
  accuracy: z.number().nullable(),
  minutesStudied: z.number(),
});

export const activityCalendarDaySchema = z.object({
  date: z.string(),
  sessionCount: z.number(),
});
export type ActivityCalendarDay = z.infer<typeof activityCalendarDaySchema>;

export const dashboardAnalyticsResponseSchema = z.object({
  today: dashboardTodaySummarySchema,
  streak: z.object({ currentStreak: z.number(), longestStreak: z.number() }),
  activityCalendar: z.array(activityCalendarDaySchema),
});
export type DashboardAnalyticsResponse = z.infer<typeof dashboardAnalyticsResponseSchema>;

export const masteryTopicSchema = z.object({
  topicId: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  depth: z.number(),
  score: z.number().nullable(),
  isProvisional: z.boolean(),
});
export type MasteryTopic = z.infer<typeof masteryTopicSchema>;
export const masteryResponseSchema = z.object({ topics: z.array(masteryTopicSchema) });
export type MasteryResponse = z.infer<typeof masteryResponseSchema>;

export const heatmapStatusSchema = z.enum(['neverStarted', 'neglected', 'scored']);
export const heatmapTopicSchema = z.object({
  topicId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  depth: z.number(),
  score: z.number().nullable(),
  status: heatmapStatusSchema,
});
export type HeatmapTopic = z.infer<typeof heatmapTopicSchema>;
export const heatmapResponseSchema = z.object({ topics: z.array(heatmapTopicSchema) });
export type HeatmapResponse = z.infer<typeof heatmapResponseSchema>;

export const reviewTrendSchema = z.enum(['up', 'down', 'flat']).nullable();
export const topicHealthRowSchema = z.object({
  topicId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  name: z.string(),
  score: z.number().nullable(),
  healthStatus: healthStatusSchema,
  lastReviewedOn: z.string().nullable(),
  nextReviewOn: z.string().nullable(),
  accuracyPct: z.number().nullable(),
  confidencePct: z.number().nullable(),
  reviewTrend: reviewTrendSchema,
});
export const topicHealthResponseSchema = z.object({ topics: z.array(topicHealthRowSchema) });
export type TopicHealthResponse = z.infer<typeof topicHealthResponseSchema>;

export const retentionEventPointSchema = z.object({ date: z.string(), score: z.number() });
export const retentionProjectionPointSchema = z.object({ date: z.string(), score: z.number() });
export const retentionResponseSchema = z.object({
  events: z.array(retentionEventPointSchema),
  projection: z.array(retentionProjectionPointSchema),
});
export type RetentionResponse = z.infer<typeof retentionResponseSchema>;

export const accuracyConfidencePointSchema = z.object({
  date: z.string(),
  accuracy: z.number(),
  confidence: z.number(),
  confidenceNormalised: z.number(),
});
export const accuracyConfidenceResponseSchema = z.object({
  points: z.array(accuracyConfidencePointSchema),
});
export type AccuracyConfidenceResponse = z.infer<typeof accuracyConfidenceResponseSchema>;

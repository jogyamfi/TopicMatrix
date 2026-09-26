import { z } from 'zod';
import { algorithmSchema, manualIntervalsSchema, themeSchema } from './domain.js';
import { timezoneSchema } from './date.js';

// Single source of truth for /me/settings request/response shapes (FR-8.1, FR-8.2, P10).

export const updateUserSettingsRequestSchema = z
  .object({
    timezone: timezoneSchema.optional(),
    dayStartHour: z.number().int().min(0).max(23).optional(),
    defaultAlgorithm: algorithmSchema.optional(),
    manualIntervals: manualIntervalsSchema.optional(),
    neglectThresholdDays: z.number().int().positive().optional(),
    weightAccuracy: z.number().min(0).max(1).optional(),
    weightConfidence: z.number().min(0).max(1).optional(),
    weightRecency: z.number().min(0).max(1).optional(),
    strongThreshold: z.number().min(0).max(100).optional(),
    needsReviewThreshold: z.number().min(0).max(100).optional(),
    theme: themeSchema.optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpdateUserSettingsRequest = z.infer<typeof updateUserSettingsRequestSchema>;

export const userSettingsViewSchema = z.object({
  timezone: z.string(),
  dayStartHour: z.number(),
  defaultAlgorithm: algorithmSchema,
  manualIntervals: manualIntervalsSchema,
  neglectThresholdDays: z.number(),
  weightAccuracy: z.number(),
  weightConfidence: z.number(),
  weightRecency: z.number(),
  strongThreshold: z.number(),
  needsReviewThreshold: z.number(),
  theme: themeSchema,
});
export type UserSettingsView = z.infer<typeof userSettingsViewSchema>;

// `schedulesChanged` (PATCH only): next-review dates that moved because the default algorithm
// or manual ladder changed (FR-5.7).
export const userSettingsResponseSchema = z.object({
  settings: userSettingsViewSchema,
  schedulesChanged: z.number().int().optional(),
});
export type UserSettingsResponse = z.infer<typeof userSettingsResponseSchema>;

// Live preview of a scoring-weight/threshold change against a sample topic (FR-8.2 task 2) —
// an optional topicId targets a specific topic; omitted, the server picks the user's own topic
// with the most logged sessions (a `null` response means the user has no topics at all yet).
export const settingsPreviewRequestSchema = z.object({
  topicId: z.string().optional(),
  weightAccuracy: z.number().min(0).max(1),
  weightConfidence: z.number().min(0).max(1),
  weightRecency: z.number().min(0).max(1),
  strongThreshold: z.number().min(0).max(100),
  needsReviewThreshold: z.number().min(0).max(100),
});
export type SettingsPreviewRequest = z.infer<typeof settingsPreviewRequestSchema>;

const settingsPreviewSideSchema = z.object({
  score: z.number().nullable(),
  healthStatus: z.string(),
});

export const settingsPreviewResponseSchema = z.object({
  preview: z
    .object({
      topicId: z.string(),
      topicName: z.string(),
      current: settingsPreviewSideSchema,
      proposed: settingsPreviewSideSchema,
    })
    .nullable(),
});
export type SettingsPreviewResponse = z.infer<typeof settingsPreviewResponseSchema>;

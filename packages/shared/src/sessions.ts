import { z } from 'zod';
import { dateOnlySchema } from './date.js';

// Single source of truth for StudySession request shapes (P5, FR-4.1). `accuracy` is never
// accepted here \u2014 it's always computed server-side from questionsCorrect/questionsAttempted
// (FR-4.2, packages/db/src/repositories/study-session.ts). `studiedOn` is optional on create:
// when omitted, the route defaults it to the user's current day (FR-5.9's day-start-hour rule).

const questionsCorrectWithinAttempted: { message: string; path: (string | number)[] } = {
  message: 'questionsCorrect cannot exceed questionsAttempted',
  path: ['questionsCorrect'],
};

export const createStudySessionRequestSchema = z
  .object({
    studiedOn: dateOnlySchema.optional(),
    sourceLabel: z.string().trim().max(120).nullable().optional(),
    questionsAttempted: z.number().int().min(1),
    questionsCorrect: z.number().int().min(0),
    confidence: z.number().int().min(1).max(5),
    durationMinutes: z.number().int().min(0).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    /** Persisted override for the grade replay uses (FR-5.4) \u2014 omitted means "use the computed grade". */
    gradeUsed: z.number().int().min(1).max(4).nullable().optional(),
  })
  .refine((v) => v.questionsCorrect <= v.questionsAttempted, questionsCorrectWithinAttempted);
export type CreateStudySessionRequest = z.infer<typeof createStudySessionRequestSchema>;

export const updateStudySessionRequestSchema = z
  .object({
    studiedOn: dateOnlySchema.optional(),
    sourceLabel: z.string().trim().max(120).nullable().optional(),
    questionsAttempted: z.number().int().min(1).optional(),
    questionsCorrect: z.number().int().min(0).optional(),
    confidence: z.number().int().min(1).max(5).optional(),
    durationMinutes: z.number().int().min(0).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    gradeUsed: z.number().int().min(1).max(4).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  })
  .refine(
    (v) =>
      v.questionsAttempted === undefined ||
      v.questionsCorrect === undefined ||
      v.questionsCorrect <= v.questionsAttempted,
    questionsCorrectWithinAttempted,
  );
export type UpdateStudySessionRequest = z.infer<typeof updateStudySessionRequestSchema>;

// POST /topics/:id/sessions/preview (FR-5.4) \u2014 the grade the mapping would produce, before save.
export const sessionPreviewRequestSchema = z
  .object({
    questionsAttempted: z.number().int().min(1),
    questionsCorrect: z.number().int().min(0),
    confidence: z.number().int().min(1).max(5),
  })
  .refine((v) => v.questionsCorrect <= v.questionsAttempted, questionsCorrectWithinAttempted);
export type SessionPreviewRequest = z.infer<typeof sessionPreviewRequestSchema>;

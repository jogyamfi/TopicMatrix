import { z } from 'zod';
import { algorithmSchema } from './domain.js';
import { topicTreeNodeSchema } from './topics.js';

// Single source of truth for Subject request shapes (P4) — types are inferred, never
// hand-written twice.

export const createSubjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  colour: z.string().trim().max(32).nullable().optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  sortOrder: z.number().int().optional(),
  defaultAlgorithm: algorithmSchema.nullable().optional(),
});
export type CreateSubjectRequest = z.infer<typeof createSubjectRequestSchema>;

export const updateSubjectRequestSchema = createSubjectRequestSchema
  .partial()
  .extend({ isArchived: z.boolean().optional() })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpdateSubjectRequest = z.infer<typeof updateSubjectRequestSchema>;

// Explicit typed confirmation, not just any truthy value (FR-2.4) — same convention as admin
// user deletion (packages/shared/src/auth.ts).
export const deleteSubjectRequestSchema = z.object({
  confirm: z.literal(true),
});
export type DeleteSubjectRequest = z.infer<typeof deleteSubjectRequestSchema>;

// Response shapes (P7) — mirrors packages/api-core/src/routes/subjects.ts's toSubjectView.
export const subjectViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  colour: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number(),
  isArchived: z.boolean(),
  defaultAlgorithm: algorithmSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubjectView = z.infer<typeof subjectViewSchema>;

// Subject-card summary (FR-2.5) — topic count, aggregate competency, due-today count, last
// activity date. See packages/db/src/subject-summary.ts.
export const subjectSummarySchema = z.object({
  topicCount: z.number(),
  aggregateScore: z.number().nullable(),
  dueTodayCount: z.number(),
  lastActivityOn: z.string().nullable(),
});
export type SubjectSummary = z.infer<typeof subjectSummarySchema>;

export const subjectListItemSchema = subjectViewSchema.extend({ summary: subjectSummarySchema });
export type SubjectListItem = z.infer<typeof subjectListItemSchema>;

export const subjectsListResponseSchema = z.object({ subjects: z.array(subjectListItemSchema) });
export type SubjectsListResponse = z.infer<typeof subjectsListResponseSchema>;

// `schedulesChanged` (PATCH only): next-review dates that moved because the subject's default
// algorithm changed (FR-5.7).
export const subjectResponseSchema = z.object({
  subject: subjectViewSchema,
  schedulesChanged: z.number().int().optional(),
});
export type SubjectResponse = z.infer<typeof subjectResponseSchema>;

export const subjectTreeResponseSchema = z.object({
  subject: subjectViewSchema,
  tree: z.array(topicTreeNodeSchema),
});
export type SubjectTreeResponse = z.infer<typeof subjectTreeResponseSchema>;

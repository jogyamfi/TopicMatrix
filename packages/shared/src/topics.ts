import { z } from 'zod';
import { algorithmSchema, topicDeleteModeSchema } from './domain.js';

// Single source of truth for Topic request shapes (P4) — types are inferred, never
// hand-written twice.

export const createTopicRequestSchema = z.object({
  subjectId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(4000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  algorithmOverride: algorithmSchema.nullable().optional(),
});
export type CreateTopicRequest = z.infer<typeof createTopicRequestSchema>;

export const updateTopicRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    sortOrder: z.number().int().optional(),
    algorithmOverride: algorithmSchema.nullable().optional(),
    isSuspended: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpdateTopicRequest = z.infer<typeof updateTopicRequestSchema>;

// Cross-subject re-parenting is allowed (FR-3.5): when parentId is given, its subject wins over
// an explicit subjectId — see packages/db/src/topic-tree.ts's moveTopic.
export const moveTopicRequestSchema = z
  .object({
    parentId: z.string().min(1).nullable().optional(),
    subjectId: z.string().min(1).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (v) => v.parentId !== undefined || v.subjectId !== undefined || v.sortOrder !== undefined,
    { message: 'At least one of parentId, subjectId or sortOrder must be provided' },
  );
export type MoveTopicRequest = z.infer<typeof moveTopicRequestSchema>;

// cascade vs promote (FR-3.6) — see packages/db/src/topic-tree.ts's deleteTopic.
export const deleteTopicRequestSchema = z.object({
  mode: topicDeleteModeSchema,
});
export type DeleteTopicRequest = z.infer<typeof deleteTopicRequestSchema>;

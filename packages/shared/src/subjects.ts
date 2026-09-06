import { z } from 'zod';
import { algorithmSchema } from './domain.js';

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

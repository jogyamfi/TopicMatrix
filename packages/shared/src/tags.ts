import { z } from 'zod';

// Single source of truth for Tag request shapes (P4, FR-3.9).

export const createTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;

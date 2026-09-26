import { z } from 'zod';
import { healthStatusSchema } from './domain.js';

// Single source of truth for Tag request shapes (P4, FR-3.9).

export const createTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;

// Response shapes (P7) — mirrors packages/api-core/src/routes/tags.ts's view functions.
export const tagViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type TagView = z.infer<typeof tagViewSchema>;

export const tagsListResponseSchema = z.object({ tags: z.array(tagViewSchema) });
export type TagsListResponse = z.infer<typeof tagsListResponseSchema>;

export const tagResponseSchema = z.object({ tag: tagViewSchema });
export type TagResponse = z.infer<typeof tagResponseSchema>;

// PATCH /tags/:id (R4) — rename; same rules as create.
export const renameTagRequestSchema = createTagRequestSchema;
export type RenameTagRequest = z.infer<typeof renameTagRequestSchema>;

// Cross-subject tag filter (FR-3.9): each tagged topic with its live score and health (R4 —
// previously placeholder metrics), from the same computation as the Topic Health View.
export const taggedTopicViewSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  name: z.string(),
  score: z.number().nullable(),
  healthStatus: healthStatusSchema,
  nextReviewOn: z.string().nullable(),
});
export type TaggedTopicView = z.infer<typeof taggedTopicViewSchema>;

export const topicsForTagResponseSchema = z.object({ topics: z.array(taggedTopicViewSchema) });
export type TopicsForTagResponse = z.infer<typeof topicsForTagResponseSchema>;

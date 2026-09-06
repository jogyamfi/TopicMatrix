import { z } from 'zod';
import { topicMetricsSchema } from './topics.js';

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

// Cross-subject tag filter (FR-3.9) — a lightweight topic summary, not the full TopicView.
export const topicSummaryViewSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  depth: z.number(),
  metrics: topicMetricsSchema,
});
export type TopicSummaryView = z.infer<typeof topicSummaryViewSchema>;

export const topicsForTagResponseSchema = z.object({ topics: z.array(topicSummaryViewSchema) });
export type TopicsForTagResponse = z.infer<typeof topicsForTagResponseSchema>;

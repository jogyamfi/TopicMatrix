import { z } from 'zod';
import { algorithmSchema, healthStatusSchema, topicDeleteModeSchema } from './domain.js';

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
// an explicit subjectId — see packages/db/src/topic-tree.ts's moveTopic. `position` is the
// 0-based slot among the destination's siblings (clamped); the server renumbers the group.
export const moveTopicRequestSchema = z
  .object({
    parentId: z.string().min(1).nullable().optional(),
    subjectId: z.string().min(1).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine(
    (v) => v.parentId !== undefined || v.subjectId !== undefined || v.position !== undefined,
    { message: 'At least one of parentId, subjectId or position must be provided' },
  );
export type MoveTopicRequest = z.infer<typeof moveTopicRequestSchema>;

// cascade vs promote (FR-3.6) — see packages/db/src/topic-tree.ts's deleteTopic.
export const deleteTopicRequestSchema = z.object({
  mode: topicDeleteModeSchema,
});
export type DeleteTopicRequest = z.infer<typeof deleteTopicRequestSchema>;

// Response shapes (P7) — mirrors packages/api-core/src/routes/topics.ts's toTopicView and
// topic-tree-view.ts's TopicMetricsView/TopicTreeNode. Own vs aggregate competency (FR-3.8).
export const topicMetricsSchema = z.object({
  ownScore: z.number().nullable(),
  aggregateScore: z.number().nullable(),
  ownHealthStatus: healthStatusSchema.nullable(),
  aggregateHealthStatus: healthStatusSchema.nullable(),
});
export type TopicMetrics = z.infer<typeof topicMetricsSchema>;

export const topicViewSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  notes: z.string().nullable(),
  sortOrder: z.number(),
  depth: z.number(),
  algorithmOverride: algorithmSchema.nullable(),
  isSuspended: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  metrics: topicMetricsSchema,
});
export type TopicView = z.infer<typeof topicViewSchema>;

export const topicsListResponseSchema = z.object({ topics: z.array(topicViewSchema) });
export type TopicsListResponse = z.infer<typeof topicsListResponseSchema>;

export const topicResponseSchema = z.object({
  topic: topicViewSchema,
  scheduleChanged: z.boolean().optional(),
});
export type TopicResponse = z.infer<typeof topicResponseSchema>;

// Recursive tree node (GET /subjects/:id/tree) — z.lazy is required for the self-referential
// `children` field; the explicit z.ZodType<TopicTreeNodeView> annotation is required alongside
// it, since zod can't infer a recursive schema's type on its own.
export interface TopicTreeNodeView {
  id: string;
  subjectId: string;
  parentId: string | null;
  name: string;
  notes: string | null;
  sortOrder: number;
  depth: number;
  algorithmOverride: z.infer<typeof algorithmSchema> | null;
  isSuspended: boolean;
  metrics: TopicMetrics;
  children: TopicTreeNodeView[];
}

export const topicTreeNodeSchema: z.ZodType<TopicTreeNodeView> = z.lazy(() =>
  z.object({
    id: z.string(),
    subjectId: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    notes: z.string().nullable(),
    sortOrder: z.number(),
    depth: z.number(),
    algorithmOverride: algorithmSchema.nullable(),
    isSuspended: z.boolean(),
    metrics: topicMetricsSchema,
    children: z.array(topicTreeNodeSchema),
  }),
);

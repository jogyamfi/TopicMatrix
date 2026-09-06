import type { Topic } from '@topicmatrix/db';

/**
 * Own vs aggregate competency metrics (FR-3.8) — wired for real at P5 via
 * `@topicmatrix/db`'s `computeSubjectTopicMetrics`/`computeTopicMetrics`. `placeholderTopicMetrics`
 * is kept as `buildTopicTree`'s fallback for any topic missing from the caller-supplied metrics
 * map (defensive only — every topic passed in should have an entry).
 */
export interface TopicMetricsView {
  ownScore: number | null;
  aggregateScore: number | null;
  ownHealthStatus: string | null;
  aggregateHealthStatus: string | null;
}

export function placeholderTopicMetrics(): TopicMetricsView {
  return {
    ownScore: null,
    aggregateScore: null,
    ownHealthStatus: null,
    aggregateHealthStatus: null,
  };
}

export interface TopicTreeNode {
  id: string;
  subjectId: string;
  parentId: string | null;
  name: string;
  notes: string | null;
  sortOrder: number;
  depth: number;
  algorithmOverride: string | null;
  isSuspended: boolean;
  metrics: TopicMetricsView;
  children: TopicTreeNode[];
}

/** Hard cap on a single tree response (§14.4, delivery-plan.md P4 task 7). */
export const MAX_TREE_NODES = 2000;

/** Builds a nested tree from a flat topic list already ordered by sortOrder. */
export function buildTopicTree(
  topics: Topic[],
  metricsByTopicId: ReadonlyMap<string, TopicMetricsView>,
): TopicTreeNode[] {
  const byParent = new Map<string | null, Topic[]>();
  for (const topic of topics) {
    const key = topic.parentId ?? null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(topic);
    byParent.set(key, siblings);
  }

  function toNode(topic: Topic): TopicTreeNode {
    return {
      id: topic.id,
      subjectId: topic.subjectId,
      parentId: topic.parentId,
      name: topic.name,
      notes: topic.notes,
      sortOrder: topic.sortOrder,
      depth: topic.depth,
      algorithmOverride: topic.algorithmOverride,
      isSuspended: topic.isSuspended,
      metrics: metricsByTopicId.get(topic.id) ?? placeholderTopicMetrics(),
      children: (byParent.get(topic.id) ?? []).map(toNode),
    };
  }

  return (byParent.get(null) ?? []).map(toNode);
}


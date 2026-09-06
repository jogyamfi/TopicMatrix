import { describe, expect, it } from 'vitest';
import type { Topic } from '@topicmatrix/db';
import { buildTopicTree, placeholderTopicMetrics } from './topic-tree-view.js';

function fakeTopic(overrides: Partial<Topic> & Pick<Topic, 'id'>): Topic {
  return {
    subjectId: 'subject-1',
    parentId: null,
    name: 'Topic',
    nameNormalised: 'topic',
    notes: null,
    sortOrder: 0,
    depth: 0,
    path: `/${overrides.id}/`,
    algorithmOverride: null,
    isSuspended: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildTopicTree', () => {
  it('nests a flat list into parent/child relationships', () => {
    const root = fakeTopic({ id: 'root' });
    const child = fakeTopic({ id: 'child', parentId: 'root', depth: 1, path: '/root/child/' });
    const grandchild = fakeTopic({
      id: 'grandchild',
      parentId: 'child',
      depth: 2,
      path: '/root/child/grandchild/',
    });

    const tree = buildTopicTree([root, child, grandchild], new Map());

    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe('root');
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.id).toBe('child');
    expect(tree[0]?.children[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.children[0]?.id).toBe('grandchild');
  });

  it('returns multiple root nodes for topics with no parent', () => {
    const a = fakeTopic({ id: 'a' });
    const b = fakeTopic({ id: 'b' });

    expect(buildTopicTree([a, b], new Map()).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('falls back to null-placeholder metrics for a topic missing from the metrics map', () => {
    const [node] = buildTopicTree([fakeTopic({ id: 'root' })], new Map());
    expect(node?.metrics).toEqual(placeholderTopicMetrics());
    expect(node?.metrics.ownScore).toBeNull();
    expect(node?.metrics.aggregateScore).toBeNull();
  });

  it('attaches the metrics supplied by the caller for a topic present in the map (P5)', () => {
    const metrics = {
      ownScore: 72,
      aggregateScore: 68,
      ownHealthStatus: 'strong',
      aggregateHealthStatus: 'needsReview',
    };
    const [node] = buildTopicTree([fakeTopic({ id: 'root' })], new Map([['root', metrics]]));
    expect(node?.metrics).toEqual(metrics);
  });
});

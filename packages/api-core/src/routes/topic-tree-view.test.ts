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

    const tree = buildTopicTree([root, child, grandchild]);

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

    expect(buildTopicTree([a, b]).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('attaches a null-placeholder metrics object to every node (FR-3.8, wired for real at P5)', () => {
    const [node] = buildTopicTree([fakeTopic({ id: 'root' })]);
    expect(node?.metrics).toEqual(placeholderTopicMetrics());
    expect(node?.metrics.ownScore).toBeNull();
    expect(node?.metrics.aggregateScore).toBeNull();
  });
});

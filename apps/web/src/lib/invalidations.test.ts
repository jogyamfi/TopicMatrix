import { afterEach, describe, expect, it } from 'vitest';
import { invalidations } from './invalidations';
import { queryClient, queryKeys } from './query-client';

function isInvalidated(queryKey: readonly unknown[]): boolean {
  return queryClient.getQueryState(queryKey)?.isInvalidated ?? false;
}

describe('invalidations.afterSessionWrite', () => {
  afterEach(() => queryClient.clear());

  it('refreshes the topic detail page: score cards, next review, session list and history', async () => {
    const topicKeys = [
      queryKeys.topics.detail('t1'),
      [...queryKeys.topics.detail('t1'), 'schedule'],
      queryKeys.sessions.list('t1'),
      queryKeys.sessions.history('t1'),
    ];
    for (const key of topicKeys) queryClient.setQueryData(key, {});
    queryClient.setQueryData(queryKeys.topics.detail('other-topic'), {});

    await invalidations.afterSessionWrite('s1', 't1');

    for (const key of topicKeys) expect(isInvalidated(key), JSON.stringify(key)).toBe(true);
    expect(isInvalidated(queryKeys.topics.detail('other-topic'))).toBe(false);
  });
});

describe('invalidations.afterTopicWrite', () => {
  afterEach(() => queryClient.clear());

  it('refreshes topic details, the review queue and analytics as well as the tree', async () => {
    const keys = [
      queryKeys.subjects.tree('s1'),
      queryKeys.topics.detail('t1'),
      queryKeys.topics.listBySubject('s1'),
      queryKeys.review.queue(),
      queryKeys.analytics.dashboard(),
    ];
    for (const key of keys) queryClient.setQueryData(key, {});

    await invalidations.afterTopicWrite('s1');

    for (const key of keys) expect(isInvalidated(key), JSON.stringify(key)).toBe(true);
  });
});

import { queryClient, queryKeys } from './query-client';

// The single place defining which mutations invalidate which query keys (P6 task 4). Every
// mutation from P7 onward should add its invalidation here rather than calling
// `queryClient.invalidateQueries` ad hoc from inside a component.
export const invalidations = {
  afterAdminUserCreate: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
  afterAdminUserUpdate: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
  afterAdminUserDelete: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),

  afterSubjectWrite: () => queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
  afterSubjectDelete: () => queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),

  // Topic writes/moves/deletes can change scores anywhere in the subject's tree (roll-ups) —
  // invalidate the whole subject subtree rather than trying to track exactly which nodes moved.
  afterTopicWrite: (subjectId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.tree(subjectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
    ]),
  afterTopicTagsWrite: (topicId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.topics.tags(topicId) }),

  // A session write recomputes the topic's own score AND every ancestor's aggregate roll-up, so
  // (like topic writes) it invalidates the whole subject tree rather than just the one topic.
  afterSessionWrite: (subjectId: string, topicId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.tree(subjectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.list(topicId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.history(topicId) }),
    ]),

  afterTagWrite: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags.list() }),
};

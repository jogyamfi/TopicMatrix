import { queryClient, queryKeys } from './query-client';

// The single place defining which mutations invalidate which query keys (P6 task 4). Every
// mutation from P7 onward should add its invalidation here rather than calling
// `queryClient.invalidateQueries` ad hoc from inside a component.
export const invalidations = {
  afterAdminUserCreate: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
  afterAdminUserUpdate: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
  afterAdminUserDelete: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),

  // Scoring weights/thresholds affect every score/health status shown anywhere in the app —
  // invalidate the settings row itself plus every subject/topic/analytics view that derives from it.
  afterSettingsWrite: () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.detail() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
      // A new default algorithm/ladder can move next-review dates shown on topic pages.
      queryClient.invalidateQueries({ queryKey: ['topics'] }),
      queryClient.invalidateQueries({ queryKey: ['analytics'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() }),
    ]),

  // Subject writes can archive a subject (dropping its topics from the queue and every analytics
  // view) or change its default algorithm (moving next-review dates). The `['subjects']` prefix
  // also covers each subject's detail and tree.
  afterSubjectWrite: () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
      // A new default algorithm can move next-review dates shown on topic pages.
      queryClient.invalidateQueries({ queryKey: ['topics'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() }),
      queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    ]),
  afterSubjectDelete: () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
      queryClient.invalidateQueries({ queryKey: ['topics'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() }),
      queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    ]),

  // Topic writes/moves/deletes can change scores anywhere in the subject's tree (roll-ups) —
  // invalidate the whole subject subtree rather than trying to track exactly which nodes moved.
  // A rename, suspend or algorithm change also shows up on topic detail pages, topic pickers,
  // the review queue and analytics, so those are refreshed too (`['topics']` covers every topic
  // detail and per-subject topic list).
  afterTopicWrite: (subjectId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.tree(subjectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
      queryClient.invalidateQueries({ queryKey: ['topics'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() }),
      queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    ]),
  afterTopicTagsWrite: (topicId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.topics.tags(topicId) }),

  // A session write recomputes the topic's own score AND every ancestor's aggregate roll-up, so
  // (like topic writes) it invalidates the whole subject tree rather than just the one topic.
  // `topics.detail(topicId)` is a prefix covering that topic's detail (score cards), schedule
  // ("Next review"), session list and snapshot history. It can also move the topic in or out of
  // the review queue (P8), and it changes every P9 analytics view derived from sessions/snapshots
  // (dashboard summary, streak, mastery, heatmap, health view, retention, accuracy/confidence) —
  // those don't have a narrower key to target than "everything under 'analytics'".
  afterSessionWrite: (subjectId: string, topicId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.tree(subjectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects.list() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.topics.detail(topicId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.topics.listBySubject(subjectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() }),
      queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    ]),

  afterTagWrite: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags.list() }),
};

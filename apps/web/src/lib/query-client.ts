import { QueryClient } from '@tanstack/react-query';

// One place defining staleTime and the query-key shape (P6 task 4) — later phases (P7+) extend
// `queryKeys`, they don't invent parallel conventions.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  admin: {
    users: () => ['admin', 'users'] as const,
  },
  subjects: {
    list: () => ['subjects'] as const,
    detail: (subjectId: string) => ['subjects', subjectId] as const,
    tree: (subjectId: string) => ['subjects', subjectId, 'tree'] as const,
  },
  topics: {
    listBySubject: (subjectId: string) => ['topics', 'list', subjectId] as const,
    detail: (topicId: string) => ['topics', topicId] as const,
    tags: (topicId: string) => ['topics', topicId, 'tags'] as const,
  },
  sessions: {
    list: (topicId: string) => ['topics', topicId, 'sessions'] as const,
    history: (topicId: string) => ['topics', topicId, 'history'] as const,
  },
  tags: {
    list: () => ['tags'] as const,
    topics: (tagId: string) => ['tags', tagId, 'topics'] as const,
  },
  review: {
    queue: () => ['review', 'queue'] as const,
  },
  analytics: {
    dashboard: () => ['analytics', 'dashboard'] as const,
    mastery: (subjectId: string) => ['analytics', 'mastery', subjectId] as const,
    heatmap: (subjectId: string) => ['analytics', 'heatmap', subjectId] as const,
    health: (subjectId?: string) => ['analytics', 'health', subjectId ?? 'all'] as const,
    retention: (target: { topicId: string } | { subjectId: string }, from?: string, to?: string) =>
      ['analytics', 'retention', target, from ?? null, to ?? null] as const,
    accuracyConfidence: (target: { topicId: string } | { subjectId: string }, from?: string, to?: string) =>
      ['analytics', 'accuracy-confidence', target, from ?? null, to ?? null] as const,
  },
};

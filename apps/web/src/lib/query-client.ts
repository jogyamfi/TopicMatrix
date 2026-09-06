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
};

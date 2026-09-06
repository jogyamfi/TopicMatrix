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
};

import { queryClient, queryKeys } from './query-client';

// The single place defining which mutations invalidate which query keys (P6 task 4). Every
// mutation from P7 onward should add its invalidation here rather than calling
// `queryClient.invalidateQueries` ad hoc from inside a component.
export const invalidations = {
  afterAdminUserCreate: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
  afterAdminUserUpdate: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
  afterAdminUserDelete: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
};

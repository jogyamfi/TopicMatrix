import { useQuery } from '@tanstack/react-query';
import { userSettingsResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from './api-client';
import { queryKeys } from './query-client';
import { userTodayIsoDate } from './dates';

/** The user's current day (`YYYY-MM-DD`) per their settings — see `userTodayIsoDate`. Shares
 * the Settings page's query, so it's usually already cached. */
export function useUserToday(): string {
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.detail(),
    queryFn: () => apiFetch('/me/settings', userSettingsResponseSchema),
  });
  return userTodayIsoDate(settingsQuery.data?.settings);
}

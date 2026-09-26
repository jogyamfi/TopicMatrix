import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { userSettingsResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from '../lib/api-client';
import { queryKeys } from '../lib/query-client';
import { invalidations } from '../lib/invalidations';
import { toast, toastSchedulesChanged } from '../lib/toast-store';
import { browserTimezone } from '../lib/timezones';
import { describeError } from '../lib/api-error';
import { Button } from './ui/button';

function dismissKey(userId: string, saved: string, device: string): string {
  return `topicmatrix:timezone-banner-dismissed:${userId}:${saved}:${device}`;
}

function wasDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * Offers to switch the account's timezone when this device reports a different one (R3 U-7).
 * The timezone decides which calendar day a session counts towards and when the day rolls over,
 * so a wrong one quietly skews "today", due dates and streaks. Shown once per (saved zone,
 * device zone) pair: dismissing it, or switching, sticks until either changes.
 */
export function TimezoneBanner({ userId }: { userId: string }): React.JSX.Element | null {
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.detail(),
    queryFn: () => apiFetch('/me/settings', userSettingsResponseSchema),
  });
  const [dismissedNow, setDismissedNow] = useState(false);
  const device = browserTimezone();
  const saved = settingsQuery.data?.settings.timezone;

  const switchMutation = useMutation({
    mutationFn: (timezone: string) =>
      apiFetch('/me/settings', userSettingsResponseSchema, { method: 'PATCH', body: { timezone } }),
    onSuccess: async (data) => {
      await invalidations.afterSettingsWrite();
      toast({ title: 'Timezone updated', description: `Now using ${data.settings.timezone}.` });
      toastSchedulesChanged(data.schedulesChanged);
    },
    onError: (err) =>
      toast({ title: 'Could not update timezone', description: describeError(err), variant: 'destructive' }),
  });

  if (!device || !saved || device === saved || dismissedNow) return null;
  const key = dismissKey(userId, saved, device);
  if (wasDismissed(key)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Not remembered across reloads without storage; hidden for this page view regardless.
    }
    setDismissedNow(true);
  };

  return (
    <div
      role="region"
      aria-label="Timezone"
      className="flex flex-wrap items-center gap-3 border-b bg-muted px-4 py-2 text-sm"
    >
      <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        This device is set to <strong>{device}</strong>, but TopicMatrix is using <strong>{saved}</strong> to decide
        which day your sessions count towards.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={switchMutation.isPending} onClick={() => switchMutation.mutate(device)}>
          Use {device}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Keep {saved}
        </Button>
      </div>
    </div>
  );
}

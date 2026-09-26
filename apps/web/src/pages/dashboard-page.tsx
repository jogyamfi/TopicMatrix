import { useQuery } from '@tanstack/react-query';
import { Flame, Trophy } from 'lucide-react';
import { dashboardAnalyticsResponseSchema } from '@topicmatrix/shared';
import { useAuth } from '../context/auth-context';
import { apiFetch } from '../lib/api-client';
import { queryKeys } from '../lib/query-client';
import { describeError } from '../lib/api-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState } from '../components/empty-state';
import { ActivityCalendar } from '../components/activity-calendar';
import { ReviewQueueSection } from './review/review-queue-section';
import { OnboardingChecklist } from '../components/onboarding-checklist';

function TodaySummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
    </div>
  );
}

/** Today's summary, streak and activity calendar (FR-7.2, FR-7.3, delivery-plan.md P9). */
function AnalyticsSummary(): React.JSX.Element {
  const query = useQuery({
    queryKey: queryKeys.analytics.dashboard(),
    queryFn: () => apiFetch('/analytics/dashboard', dashboardAnalyticsResponseSchema),
  });

  if (query.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (query.isError) {
    return <EmptyState title="Could not load analytics" description={describeError(query.error)} />;
  }

  const { today, streak, activityCalendar } = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TodaySummaryCard label="Topics reviewed" value={String(today.topicsReviewed)} />
        <TodaySummaryCard label="Questions attempted" value={String(today.questionsAttempted)} />
        <TodaySummaryCard
          label="Accuracy"
          value={today.accuracy === null ? '\u2014' : `${Math.round(today.accuracy * 100)}%`}
        />
        <TodaySummaryCard label="Minutes studied" value={String(today.minutesStudied)} />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <Flame className="size-4 text-orange-500" aria-hidden="true" />
          <strong>{streak.currentStreak}</strong> day streak
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Trophy className="size-4 text-amber-500" aria-hidden="true" />
          Longest: <strong>{streak.longestStreak}</strong> days
        </span>
      </div>
      <ActivityCalendar days={activityCalendar} />
    </div>
  );
}

/** Dashboard (P6 shell, P8 review queue widget, P9 analytics summary). */
export default function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <OnboardingChecklist />
      <Card>
        <CardHeader>
          <CardTitle>Welcome back{user ? `, ${user.displayName}` : ''}</CardTitle>
          <CardDescription>Your progress at a glance.</CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyticsSummary />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Review queue</CardTitle>
          <CardDescription>What's due for review today.</CardDescription>
        </CardHeader>
        <CardContent>
          <ReviewQueueSection compact />
        </CardContent>
      </Card>
    </div>
  );
}


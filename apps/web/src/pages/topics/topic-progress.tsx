import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accuracyConfidenceResponseSchema, retentionResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { resolveDateRange, type DateRangePreset } from '../../lib/date-range';
import { useUserToday } from '../../lib/use-user-today';
import { describeError } from '../../lib/api-error';
import { DateRangeSelector } from '../../components/date-range-selector';
import { EmptyState } from '../../components/empty-state';
import { RetentionCurveChart } from '../../components/charts/retention-curve-chart';
import { AccuracyConfidenceChart } from '../../components/charts/accuracy-confidence-chart';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';

function rangeParams(target: { topicId: string }, from?: string, to?: string): string {
  return new URLSearchParams({ topicId: target.topicId, ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
}

/**
 * The topic's own retention curve and accuracy-vs-confidence chart (FR-7.7, FR-7.8), so a
 * learner sees how this topic is going where they log it — not only on the Analytics page.
 * Same endpoints, query keys and chart components as Analytics, scoped to one topic.
 */
export function TopicProgress({ topicId, hasSessions }: { topicId: string; hasSessions: boolean }): React.JSX.Element {
  const [range, setRange] = useState<DateRangePreset>('90');
  const today = useUserToday();
  const { from, to } = resolveDateRange(range, today);
  const target = { topicId };

  const retentionQuery = useQuery({
    queryKey: queryKeys.analytics.retention(target, from, to),
    queryFn: () => apiFetch(`/analytics/retention?${rangeParams(target, from, to)}`, retentionResponseSchema),
    enabled: hasSessions,
  });
  const accuracyQuery = useQuery({
    queryKey: queryKeys.analytics.accuracyConfidence(target, from, to),
    queryFn: () =>
      apiFetch(`/analytics/accuracy-confidence?${rangeParams(target, from, to)}`, accuracyConfidenceResponseSchema),
    enabled: hasSessions,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-lg">Progress</CardTitle>
        {hasSessions ? <DateRangeSelector value={range} onChange={setRange} /> : null}
      </CardHeader>
      <CardContent>
        {!hasSessions ? (
          <EmptyState
            title="No sessions yet"
            description="Log a session to start this topic's retention curve and accuracy history."
          />
        ) : (
          <Tabs defaultValue="retention">
            <TabsList>
              <TabsTrigger value="retention">Retention</TabsTrigger>
              <TabsTrigger value="accuracy-confidence">Accuracy vs confidence</TabsTrigger>
            </TabsList>
            <TabsContent value="retention">
              {retentionQuery.isPending ? (
                <Skeleton className="h-64 w-full" />
              ) : retentionQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  Could not load the retention curve: {describeError(retentionQuery.error)}
                </p>
              ) : retentionQuery.data.events.length === 0 ? (
                <EmptyState title="Nothing in this range" description="Try a longer date range." />
              ) : (
                <RetentionCurveChart data={retentionQuery.data} />
              )}
            </TabsContent>
            <TabsContent value="accuracy-confidence">
              {accuracyQuery.isPending ? (
                <Skeleton className="h-64 w-full" />
              ) : accuracyQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  Could not load accuracy vs confidence: {describeError(accuracyQuery.error)}
                </p>
              ) : accuracyQuery.data.points.length === 0 ? (
                <EmptyState title="Nothing in this range" description="Try a longer date range." />
              ) : (
                <AccuracyConfidenceChart data={accuracyQuery.data} />
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

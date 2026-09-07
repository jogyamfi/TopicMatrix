import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  subjectsListResponseSchema,
  topicsListResponseSchema,
  masteryResponseSchema,
  heatmapResponseSchema,
  topicHealthResponseSchema,
  retentionResponseSchema,
  accuracyConfidenceResponseSchema,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { describeError } from '../admin/users-page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { DateRangeSelector } from '../../components/date-range-selector';
import { resolveDateRange, type DateRangePreset } from '../../lib/date-range';
import { MasteryBarChart } from '../../components/charts/mastery-bar-chart';
import { TopicHeatmapGrid } from '../../components/charts/topic-heatmap-grid';
import { RetentionCurveChart } from '../../components/charts/retention-curve-chart';
import { AccuracyConfidenceChart } from '../../components/charts/accuracy-confidence-chart';
import { TopicHealthTable } from './topic-health-table';

const ALL_SUBJECTS = 'all';
const WHOLE_SUBJECT = 'whole-subject';

function ErrorState({ error }: { error: unknown }): React.JSX.Element {
  return <EmptyState title="Something went wrong" description={describeError(error)} />;
}

function useSubjects() {
  return useQuery({
    queryKey: queryKeys.subjects.list(),
    queryFn: () => apiFetch('/subjects', subjectsListResponseSchema),
  });
}

function useTopics(subjectId: string | null) {
  return useQuery({
    queryKey: queryKeys.topics.listBySubject(subjectId ?? ''),
    queryFn: () => apiFetch(`/topics?subjectId=${subjectId}`, topicsListResponseSchema),
    enabled: subjectId !== null,
  });
}

function SubjectSelect({
  value,
  onChange,
  includeAllOption,
}: {
  value: string;
  onChange: (value: string) => void;
  includeAllOption?: boolean;
}): React.JSX.Element {
  const subjectsQuery = useSubjects();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-56" aria-label="Subject">
        <SelectValue placeholder="Select a subject" />
      </SelectTrigger>
      <SelectContent>
        {includeAllOption ? <SelectItem value={ALL_SUBJECTS}>All subjects</SelectItem> : null}
        {(subjectsQuery.data?.subjects ?? []).map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MasteryTab({ subjectId }: { subjectId: string | null }): React.JSX.Element {
  const query = useQuery({
    queryKey: queryKeys.analytics.mastery(subjectId ?? ''),
    queryFn: () => apiFetch(`/analytics/mastery?subjectId=${subjectId}`, masteryResponseSchema),
    enabled: subjectId !== null,
  });
  if (!subjectId) {
    return <EmptyState title="Pick a subject" description="Choose a subject above to see its mastery chart." />;
  }
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorState error={query.error} />;
  if (query.data.topics.length === 0) {
    return <EmptyState title="No topics yet" description="Add topics to this subject to see mastery data." />;
  }
  return <MasteryBarChart topics={query.data.topics} />;
}

function HeatmapTab({ subjectId }: { subjectId: string | null }): React.JSX.Element {
  const query = useQuery({
    queryKey: queryKeys.analytics.heatmap(subjectId ?? ''),
    queryFn: () => apiFetch(`/analytics/heatmap?subjectId=${subjectId}`, heatmapResponseSchema),
    enabled: subjectId !== null,
  });
  if (!subjectId) {
    return <EmptyState title="Pick a subject" description="Choose a subject above to see its heatmap." />;
  }
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorState error={query.error} />;
  if (query.data.topics.length === 0) {
    return <EmptyState title="No topics yet" description="Add topics to this subject to see a heatmap." />;
  }
  return <TopicHeatmapGrid topics={query.data.topics} />;
}

function HealthViewTab({ subjectId }: { subjectId: string }): React.JSX.Element {
  const scopedSubjectId = subjectId === ALL_SUBJECTS ? undefined : subjectId;
  const query = useQuery({
    queryKey: queryKeys.analytics.health(scopedSubjectId),
    queryFn: () =>
      apiFetch(
        `/analytics/health${scopedSubjectId ? `?subjectId=${scopedSubjectId}` : ''}`,
        topicHealthResponseSchema,
      ),
  });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorState error={query.error} />;
  if (query.data.topics.length === 0) {
    return <EmptyState title="No topics yet" description="Add a subject and some topics to see the health view." />;
  }
  return <TopicHealthTable topics={query.data.topics} />;
}

function RetentionTab({ subjectId }: { subjectId: string | null }): React.JSX.Element {
  const [topicId, setTopicId] = useState<string>(WHOLE_SUBJECT);
  const [range, setRange] = useState<DateRangePreset>('90');
  const topicsQuery = useTopics(subjectId);
  const target = topicId === WHOLE_SUBJECT ? { subjectId: subjectId ?? '' } : { topicId };
  const { from, to } = resolveDateRange(range);

  const query = useQuery({
    queryKey: queryKeys.analytics.retention(target, from, to),
    queryFn: () => {
      const params = new URLSearchParams({
        ...('topicId' in target ? { topicId: target.topicId } : { subjectId: target.subjectId }),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      return apiFetch(`/analytics/retention?${params.toString()}`, retentionResponseSchema);
    },
    enabled: subjectId !== null,
  });

  if (!subjectId) {
    return <EmptyState title="Pick a subject" description="Choose a subject above to see its retention curve." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={topicId} onValueChange={setTopicId}>
          <SelectTrigger className="w-56" aria-label="Topic">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_SUBJECT}>Whole subject</SelectItem>
            {(topicsQuery.data?.topics ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeSelector value={range} onChange={setRange} />
      </div>
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data.events.length === 0 ? (
        <EmptyState
          title="No history yet"
          description="Log a study session to start building a retention curve."
        />
      ) : (
        <RetentionCurveChart data={query.data} />
      )}
    </div>
  );
}

function AccuracyConfidenceTab({ subjectId }: { subjectId: string | null }): React.JSX.Element {
  const [topicId, setTopicId] = useState<string>(WHOLE_SUBJECT);
  const [range, setRange] = useState<DateRangePreset>('90');
  const topicsQuery = useTopics(subjectId);
  const target = topicId === WHOLE_SUBJECT ? { subjectId: subjectId ?? '' } : { topicId };
  const { from, to } = resolveDateRange(range);

  const query = useQuery({
    queryKey: queryKeys.analytics.accuracyConfidence(target, from, to),
    queryFn: () => {
      const params = new URLSearchParams({
        ...('topicId' in target ? { topicId: target.topicId } : { subjectId: target.subjectId }),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      return apiFetch(`/analytics/accuracy-confidence?${params.toString()}`, accuracyConfidenceResponseSchema);
    },
    enabled: subjectId !== null,
  });

  if (!subjectId) {
    return <EmptyState title="Pick a subject" description="Choose a subject above to compare accuracy and confidence." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={topicId} onValueChange={setTopicId}>
          <SelectTrigger className="w-56" aria-label="Topic">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_SUBJECT}>Whole subject</SelectItem>
            {(topicsQuery.data?.topics ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeSelector value={range} onChange={setRange} />
      </div>
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data.points.length === 0 ? (
        <EmptyState title="No sessions yet" description="Log a study session to see accuracy vs confidence." />
      ) : (
        <AccuracyConfidenceChart data={query.data} />
      )}
    </div>
  );
}

/** Dashboard & Analytics (delivery-plan.md P9, FR-7.2\u2013FR-7.9). */
export default function AnalyticsPage(): React.JSX.Element {
  const [subjectId, setSubjectId] = useState<string>(ALL_SUBJECTS);
  const effectiveSubjectId = useMemo(() => (subjectId === ALL_SUBJECTS ? null : subjectId), [subjectId]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Analytics</CardTitle>
            <CardDescription>Progress, weakness and forgetting, made visible.</CardDescription>
          </div>
          <SubjectSelect value={subjectId} onChange={setSubjectId} includeAllOption />
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="health">
            <TabsList>
              <TabsTrigger value="health">Health view</TabsTrigger>
              <TabsTrigger value="mastery">Mastery</TabsTrigger>
              <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
              <TabsTrigger value="retention">Retention</TabsTrigger>
              <TabsTrigger value="accuracy-confidence">Accuracy vs confidence</TabsTrigger>
            </TabsList>
            <TabsContent value="health">
              <HealthViewTab subjectId={subjectId} />
            </TabsContent>
            <TabsContent value="mastery">
              <MasteryTab subjectId={effectiveSubjectId} />
            </TabsContent>
            <TabsContent value="heatmap">
              <HeatmapTab subjectId={effectiveSubjectId} />
            </TabsContent>
            <TabsContent value="retention">
              <RetentionTab subjectId={effectiveSubjectId} />
            </TabsContent>
            <TabsContent value="accuracy-confidence">
              <AccuracyConfidenceTab subjectId={effectiveSubjectId} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

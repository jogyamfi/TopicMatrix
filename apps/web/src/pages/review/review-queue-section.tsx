import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ListChecks, Minus, Pause, TrendingDown, TrendingUp } from 'lucide-react';
import {
  reviewQueueResponseSchema,
  scheduleOverrideResponseSchema,
  type ReviewQueueItem,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../admin/users-page';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { EmptyState } from '../../components/empty-state';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { LogSessionDialog } from '../topics/log-session-dialog';

const TREND_CONFIG = {
  up: { icon: TrendingUp, label: 'Improving' },
  down: { icon: TrendingDown, label: 'Declining' },
  flat: { icon: Minus, label: 'Steady' },
} as const;

function AccuracyTrend({ trend }: { trend: ReviewQueueItem['accuracyTrend'] }): React.JSX.Element | null {
  if (trend === null) return null;
  const { icon: Icon, label } = TREND_CONFIG[trend];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

function ReviewQueueRow({
  item,
  onLog,
}: {
  item: ReviewQueueItem;
  onLog: (item: ReviewQueueItem) => void;
}): React.JSX.Element {
  const scheduleMutation = useMutation({
    mutationFn: (body: { action: 'snooze'; days: number } | { action: 'suspend'; suspended: boolean }) =>
      apiFetch(`/topics/${item.topicId}/schedule/override`, scheduleOverrideResponseSchema, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidations.afterSessionWrite(item.subjectId, item.topicId),
    onError: (err) => toast({ title: 'Could not update schedule', description: describeError(err), variant: 'destructive' }),
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <Link
          to={`/subjects/${item.subjectId}/topics/${item.topicId}`}
          className="font-medium hover:underline"
        >
          {item.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{item.subjectName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <HealthStatusBadge status={item.healthStatus as HealthStatus} />
          <span className="text-xs text-muted-foreground">
            Score: {item.score === null ? '—' : Math.round(item.score)}
          </span>
          <AccuracyTrend trend={item.accuracyTrend} />
          {item.overdueDays > 0 ? (
            <span className="text-xs font-medium text-health-atRisk">
              {item.overdueDays} day{item.overdueDays === 1 ? '' : 's'} overdue
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onLog(item)}>
          <ListChecks /> Log
        </Button>
        <Select
          onValueChange={(value) => scheduleMutation.mutate({ action: 'snooze', days: Number(value) })}
        >
          <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Snooze ${item.name}`}>
            <SelectValue placeholder="Snooze" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1 day</SelectItem>
            <SelectItem value="3">3 days</SelectItem>
            <SelectItem value="7">7 days</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={scheduleMutation.isPending}
          onClick={() => scheduleMutation.mutate({ action: 'suspend', suspended: true })}
        >
          <Pause /> Suspend
        </Button>
      </div>
    </li>
  );
}

function BucketSection({
  title,
  description,
  items,
  onLog,
}: {
  title: string;
  description: string;
  items: readonly ReviewQueueItem[];
  onLog: (item: ReviewQueueItem) => void;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">({items.length})</span>
      </h3>
      <p className="text-xs text-muted-foreground">{description}</p>
      <ul className="mt-2">
        {items.map((item) => (
          <ReviewQueueRow key={item.topicId} item={item} onLog={onLog} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The Review Queue (FR-7.1, delivery-plan.md P8 task 3) \u2014 dashboard-embedded (`compact`, capped
 * to a handful of the most urgent items with a link through to the full page) and standalone
 * (`/review`, every bucket in full) both render this same component.
 */
export function ReviewQueueSection({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const queryClient = useQueryClient();
  const queueQuery = useQuery({
    queryKey: queryKeys.review.queue(),
    queryFn: () => apiFetch('/review/queue', reviewQueueResponseSchema),
  });
  const [logTarget, setLogTarget] = useState<ReviewQueueItem | null>(null);

  if (queueQuery.isPending) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (queueQuery.isError || !queueQuery.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the review queue: {describeError(queueQuery.error)}
      </p>
    );
  }

  const { overdue, dueToday, dueNext7Days } = queueQuery.data;
  const total = overdue.length + dueToday.length + dueNext7Days.length;
  const limit = compact ? 5 : Number.POSITIVE_INFINITY;
  const take = (items: readonly ReviewQueueItem[], used: number) => items.slice(0, Math.max(0, limit - used));

  const shownOverdue = take(overdue, 0);
  const shownDueToday = take(dueToday, shownOverdue.length);
  const shownDueNext7 = take(dueNext7Days, shownOverdue.length + shownDueToday.length);

  if (total === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="size-8" />}
        title="Nothing due"
        description="Every topic is on schedule. Check back tomorrow, or start a weakest-topics session."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <BucketSection title="Overdue" description="Past their scheduled review date." items={shownOverdue} onLog={setLogTarget} />
      <BucketSection title="Due today" description="Scheduled for today." items={shownDueToday} onLog={setLogTarget} />
      <BucketSection
        title="Due in the next 7 days"
        description="Coming up soon."
        items={shownDueNext7}
        onLog={setLogTarget}
      />
      {compact && total > limit ? (
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link to="/review">View all {total} due</Link>
        </Button>
      ) : null}
      <LogSessionDialog
        topic={logTarget ? { id: logTarget.topicId, subjectId: logTarget.subjectId, name: logTarget.name } : null}
        onOpenChange={(open) => !open && setLogTarget(null)}
        onLogged={() => queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() })}
      />
    </div>
  );
}

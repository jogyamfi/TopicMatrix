import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ListChecks, Minus, Pause, Sprout, TrendingDown, TrendingUp } from 'lucide-react';
import {
  reviewQueueResponseSchema,
  scheduleOverrideResponseSchema,
  type ReviewQueueItem,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../../lib/api-error';
import { formatDateOnly } from '../../lib/dates';
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
  emptyNote,
}: {
  title: string;
  description: string;
  items: readonly ReviewQueueItem[];
  onLog: (item: ReviewQueueItem) => void;
  /** Shown instead of hiding the bucket when it's empty (the full page); omitted = hide it. */
  emptyNote?: string;
}): React.JSX.Element | null {
  if (items.length === 0) {
    if (!emptyNote) return null;
    return (
      <div>
        <h3 className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">(0)</span>
        </h3>
        <p className="text-xs text-muted-foreground">{emptyNote}</p>
      </div>
    );
  }
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
 * Never-studied topics (R3 U-5) — not due (SRS Q2), so kept out of the due buckets, but listed so
 * a new learner's queue shows where to start. A native `<details>`: collapsible, keyboard- and
 * screen-reader-friendly for free; open by default when nothing is due.
 */
function NotStartedSection({
  items,
  total,
  defaultOpen,
  onLog,
}: {
  items: readonly ReviewQueueItem[];
  total: number;
  defaultOpen: boolean;
  onLog: (item: ReviewQueueItem) => void;
}): React.JSX.Element | null {
  if (total === 0) return null;
  return (
    <details open={defaultOpen} className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Not started yet <span className="font-normal text-muted-foreground">({total})</span>
      </summary>
      <p className="mt-1 text-xs text-muted-foreground">
        Topics you haven&apos;t studied yet. Log a first session to start scheduling their reviews.
        {total > items.length ? ` Showing the ${items.length} oldest.` : ''}
      </p>
      <ul className="mt-2">
        {items.map((item) => (
          <li key={item.topicId} className="flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0">
            <div className="min-w-0 flex-1">
              <Link to={`/subjects/${item.subjectId}/topics/${item.topicId}`} className="font-medium hover:underline">
                {item.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{item.subjectName}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onLog(item)}>
              <Sprout /> Log first session
            </Button>
          </li>
        ))}
      </ul>
    </details>
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

  const { overdue, dueToday, dueNext7Days, notStarted, notStartedTotal, nextReviewOn } = queueQuery.data;
  const total = overdue.length + dueToday.length + dueNext7Days.length;
  const limit = compact ? 5 : Number.POSITIVE_INFINITY;
  const take = (items: readonly ReviewQueueItem[], used: number) => items.slice(0, Math.max(0, limit - used));

  const shownOverdue = take(overdue, 0);
  const shownDueToday = take(dueToday, shownOverdue.length);
  const shownDueNext7 = take(dueNext7Days, shownOverdue.length + shownDueToday.length);
  const nextReviewNote = nextReviewOn ? `Next review: ${formatDateOnly(nextReviewOn)}.` : undefined;

  return (
    <div className="flex flex-col gap-6">
      {total === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8" />}
          title="Nothing due"
          description={
            nextReviewNote
              ? `Every topic is on schedule. ${nextReviewNote}`
              : notStartedTotal > 0
                ? 'No reviews are scheduled yet. Start with one of the topics below.'
                : 'Add topics and log a session to start building your review schedule.'
          }
        />
      ) : (
        <>
          <BucketSection
            title="Overdue"
            description="Past their scheduled review date."
            items={shownOverdue}
            onLog={setLogTarget}
            {...(compact ? {} : { emptyNote: 'Nothing overdue.' })}
          />
          <BucketSection
            title="Due today"
            description="Scheduled for today."
            items={shownDueToday}
            onLog={setLogTarget}
            {...(compact ? {} : { emptyNote: 'Nothing else due today.' })}
          />
          <BucketSection
            title="Due in the next 7 days"
            description="Coming up soon."
            items={shownDueNext7}
            onLog={setLogTarget}
            {...(compact ? {} : { emptyNote: 'Nothing due in the next 7 days.' })}
          />
        </>
      )}
      {compact && total > limit ? (
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link to="/review">View all {total} due</Link>
        </Button>
      ) : null}
      {compact ? (
        total === 0 && notStartedTotal > 0 ? (
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link to="/review">
              {notStartedTotal} topic{notStartedTotal === 1 ? '' : 's'} not started yet
            </Link>
          </Button>
        ) : null
      ) : (
        <NotStartedSection items={notStarted} total={notStartedTotal} defaultOpen={total === 0} onLog={setLogTarget} />
      )}
      <LogSessionDialog
        topic={logTarget ? { id: logTarget.topicId, subjectId: logTarget.subjectId, name: logTarget.name } : null}
        onOpenChange={(open) => !open && setLogTarget(null)}
        onLogged={() => queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() })}
      />
    </div>
  );
}

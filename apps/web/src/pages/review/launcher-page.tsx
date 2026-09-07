import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ListChecks, SkipForward } from 'lucide-react';
import { scheduleOverrideResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { toast } from '../../lib/toast-store';
import { describeError } from '../admin/users-page';
import { advanceLauncherRun, clearLauncherRun, loadLauncherRun, type LauncherRun } from '../../lib/launcher-store';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { EmptyState } from '../../components/empty-state';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { LogSessionDialog } from '../topics/log-session-dialog';

/** Narrows a nullable/undefined value with a real runtime check, never a bare `!` assertion. */
function mustExist<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/**
 * Study Session Launcher (FR-6.3, FR-6.5, delivery-plan.md P8 task 4/6) \u2014 one topic at a time,
 * reading/writing its progress through `launcher-store.ts` so a refresh resumes at the same item
 * instead of losing the run (plain `useState` alone wouldn't survive that).
 */
export default function LauncherPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [run, setRun] = useState<LauncherRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    setRun(loadLauncherRun());
    setLoaded(true);
  }, []);

  const scheduleMutation = useMutation({
    mutationFn: (vars: { topicId: string; days: number }) =>
      apiFetch(`/topics/${vars.topicId}/schedule/override`, scheduleOverrideResponseSchema, {
        method: 'POST',
        body: { action: 'snooze', days: vars.days },
      }),
    onError: (err) =>
      toast({ title: 'Could not snooze topic', description: describeError(err), variant: 'destructive' }),
  });

  if (!loaded) {
    return <div aria-hidden="true" />;
  }

  if (!run || run.items.length === 0) {
    return (
      <EmptyState
        title="No active review session"
        description="Start one from the review queue."
        action={
          <Button asChild>
            <Link to="/review">Go to review queue</Link>
          </Button>
        }
      />
    );
  }

  const advance = () => setRun(advanceLauncherRun(run));

  if (run.index >= run.items.length) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="size-8" />}
        title="Session complete"
        description={`You reviewed ${run.items.length} topic${run.items.length === 1 ? '' : 's'}.`}
        action={
          <Button
            onClick={() => {
              clearLauncherRun();
              navigate('/');
            }}
          >
            Back to dashboard
          </Button>
        }
      />
    );
  }

  const item = mustExist(run.items[run.index], 'Launcher run index out of range');

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Topic {run.index + 1} of {run.items.length}
        </p>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.round((run.index / run.items.length) * 100)}%` }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{item.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{item.subjectName}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {item.notes ? <p className="text-sm">{item.notes}</p> : null}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <HealthStatusBadge status={item.healthStatus as HealthStatus} />
            <span className="text-muted-foreground">
              Last score: {item.score === null ? '—' : Math.round(item.score)}
            </span>
            {item.accuracyTrend ? (
              <span className="text-muted-foreground">Trend: {item.accuracyTrend}</span>
            ) : null}
            <span className="text-muted-foreground">
              Next due: {item.nextReviewOn ? new Date(item.nextReviewOn).toLocaleDateString() : '—'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={() => setLogOpen(true)}>
              <ListChecks /> Log result
            </Button>
            <Button variant="outline" onClick={advance}>
              <SkipForward /> Skip
            </Button>
            <Select
              onValueChange={(value) => {
                scheduleMutation.mutate({ topicId: item.topicId, days: Number(value) });
                advance();
              }}
            >
              <SelectTrigger className="h-9 w-32" aria-label={`Snooze ${item.name}`}>
                <SelectValue placeholder="Snooze" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 day</SelectItem>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                clearLauncherRun();
                navigate('/review');
              }}
            >
              End session
            </Button>
          </div>
        </CardContent>
      </Card>

      <LogSessionDialog
        topic={logOpen ? { id: item.topicId, subjectId: item.subjectId, name: item.name } : null}
        onOpenChange={(open) => !open && setLogOpen(false)}
        onLogged={advance}
      />
    </div>
  );
}

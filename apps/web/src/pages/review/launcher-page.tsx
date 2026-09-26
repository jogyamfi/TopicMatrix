import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, ListChecks, RotateCcw, SkipForward } from 'lucide-react';
import { scheduleOverrideResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../../lib/api-error';
import {
  advanceLauncherRun,
  clearLauncherRun,
  loadLauncherRun,
  startLauncherRun,
  summariseLauncherRun,
  type LauncherOutcome,
  type LauncherRun,
} from '../../lib/launcher-store';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { EmptyState } from '../../components/empty-state';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { LogSessionDialog } from '../topics/log-session-dialog';
import { useAuth } from '../../context/auth-context';
import { formatDateOnly } from '../../lib/dates';

const SNOOZE_DAYS = [1, 3, 7] as const;

/** True when a keypress belongs to a text field or an open overlay, not to the launcher. */
function isTypingOrInOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"], [role="listbox"], [role="menu"]') !== null
  );
}

function CompletionSummary({
  run,
  onReviewSkipped,
  onDone,
}: {
  run: LauncherRun;
  onReviewSkipped: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const summary = summariseLauncherRun(run);
  const parts = [
    `${summary.logged} logged`,
    ...(summary.skipped > 0 ? [`${summary.skipped} skipped`] : []),
    ...(summary.snoozed > 0 ? [`${summary.snoozed} snoozed`] : []),
  ];
  return (
    <EmptyState
      icon={<CheckCircle2 className="size-8" />}
      title="Session complete"
      description={`${parts.join(', ')}.${
        summary.accuracy === null ? '' : ` Accuracy across the sessions you logged: ${Math.round(summary.accuracy * 100)}%.`
      }`}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {summary.skipped > 0 ? (
            <Button variant="outline" onClick={onReviewSkipped}>
              <RotateCcw /> Review {summary.skipped} skipped topic{summary.skipped === 1 ? '' : 's'}
            </Button>
          ) : null}
          <Button onClick={onDone}>Back to dashboard</Button>
        </div>
      }
    />
  );
}

/**
 * Study Session Launcher (FR-6.3, FR-6.5, delivery-plan.md P8 task 4/6) — one topic at a time,
 * reading/writing its progress through `launcher-store.ts` so a refresh resumes at the same item
 * instead of losing the run (plain `useState` alone wouldn't survive that). Keyboard: L logs a
 * result, S skips, 1/3/7 snooze by that many days.
 */
export default function LauncherPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [run, setRun] = useState<LauncherRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    setRun(userId ? loadLauncherRun(userId) : null);
    setLoaded(true);
  }, [userId]);

  const scheduleMutation = useMutation({
    mutationFn: (vars: { topicId: string; subjectId: string; days: number }) =>
      apiFetch(`/topics/${vars.topicId}/schedule/override`, scheduleOverrideResponseSchema, {
        method: 'POST',
        body: { action: 'snooze', days: vars.days },
      }),
    // A snooze moves the topic's due date: the queue and anything showing it must refresh.
    onSuccess: (_data, vars) => invalidations.afterSessionWrite(vars.subjectId, vars.topicId),
    onError: (err) =>
      toast({ title: 'Could not snooze topic', description: describeError(err), variant: 'destructive' }),
  });

  const current = run && run.index < run.items.length ? run.items[run.index] : undefined;

  const advance = useCallback(
    (outcome: LauncherOutcome) => setRun((r) => (r ? advanceLauncherRun(r, outcome) : r)),
    [],
  );
  const skip = useCallback(() => advance({ kind: 'skipped' }), [advance]);
  const { mutate: snoozeMutate } = scheduleMutation;
  const snooze = useCallback(
    (days: number) => {
      if (!current) return;
      snoozeMutate({ topicId: current.topicId, subjectId: current.subjectId, days });
      advance({ kind: 'snoozed', days });
    },
    [current, snoozeMutate, advance],
  );

  useEffect(() => {
    if (!current || logOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingOrInOverlay(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'l') {
        event.preventDefault();
        setLogOpen(true);
      } else if (key === 's') {
        event.preventDefault();
        skip();
      } else if ((SNOOZE_DAYS as readonly number[]).includes(Number(key))) {
        event.preventDefault();
        snooze(Number(key));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, logOpen, skip, snooze]);

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

  if (!current) {
    return (
      <CompletionSummary
        run={run}
        onReviewSkipped={() => {
          if (!userId) return;
          setRun(startLauncherRun(userId, summariseLauncherRun(run).skippedItems));
        }}
        onDone={() => {
          clearLauncherRun();
          navigate('/');
        }}
      />
    );
  }

  const item = current;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Topic {run.index + 1} of {run.items.length}
        </p>
        <div
          className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Review session progress"
          aria-valuemin={0}
          aria-valuemax={run.items.length}
          aria-valuenow={run.index}
        >
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.round((run.index / run.items.length) * 100)}%` }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {/* A new tab, so following the link never loses the run. */}
            <a
              href={`/subjects/${item.subjectId}/topics/${item.topicId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:underline"
            >
              {item.name}
              <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{item.subjectName}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {item.notes ? <p className="whitespace-pre-line text-sm">{item.notes}</p> : null}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <HealthStatusBadge status={item.healthStatus as HealthStatus} />
            <span className="text-muted-foreground">
              Last score: {item.score === null ? '—' : Math.round(item.score)}
            </span>
            {item.accuracyTrend ? (
              <span className="text-muted-foreground">Trend: {item.accuracyTrend}</span>
            ) : null}
            <span className="text-muted-foreground">
              Next due: {item.nextReviewOn ? formatDateOnly(item.nextReviewOn) : '—'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={() => setLogOpen(true)} aria-keyshortcuts="L">
              <ListChecks /> Log result
            </Button>
            <Button variant="outline" onClick={skip} aria-keyshortcuts="S">
              <SkipForward /> Skip
            </Button>
            <Select value="" onValueChange={(value) => snooze(Number(value))}>
              <SelectTrigger className="h-9 w-32" aria-label={`Snooze ${item.name}`} aria-keyshortcuts="1 3 7">
                <SelectValue placeholder="Snooze" />
              </SelectTrigger>
              <SelectContent>
                {SNOOZE_DAYS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} day{days === 1 ? '' : 's'}
                  </SelectItem>
                ))}
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
          <p className="text-xs text-muted-foreground">
            Shortcuts: <kbd className="rounded border px-1">L</kbd> log result ·{' '}
            <kbd className="rounded border px-1">S</kbd> skip · <kbd className="rounded border px-1">1</kbd>/
            <kbd className="rounded border px-1">3</kbd>/<kbd className="rounded border px-1">7</kbd> snooze
          </p>
        </CardContent>
      </Card>

      <LogSessionDialog
        topic={logOpen ? { id: item.topicId, subjectId: item.subjectId, name: item.name } : null}
        onOpenChange={(open) => !open && setLogOpen(false)}
        onLogged={(session) =>
          advance({
            kind: 'logged',
            questionsAttempted: session.questionsAttempted,
            questionsCorrect: session.questionsCorrect,
          })
        }
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, RotateCcw, X } from 'lucide-react';
import { scoreSample, type ScoringSample } from '@topicmatrix/core';
import {
  settingsPreviewResponseSchema,
  updateUserSettingsRequestSchema,
  userSettingsResponseSchema,
  type ScoringSampleView,
  type Algorithm,
  type UpdateUserSettingsRequest,
  type UserSettingsView,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { invalidations } from '../../lib/invalidations';
import { toast, toastSchedulesChanged } from '../../lib/toast-store';
import { describeError } from '../../lib/api-error';
import { useFormErrors } from '../../lib/form-errors';
import { allTimezones, browserTimezone } from '../../lib/timezones';
import { FieldError, FormError } from '../../components/field-error';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

const ALGORITHM_LABELS: Record<Algorithm, string> = { fsrs: 'FSRS', sm2: 'SM-2', manual: 'Manual' };

type FormState = UserSettingsView;

function toRequest(form: FormState): UpdateUserSettingsRequest {
  return {
    timezone: form.timezone,
    dayStartHour: form.dayStartHour,
    defaultAlgorithm: form.defaultAlgorithm,
    manualIntervals: form.manualIntervals,
    neglectThresholdDays: form.neglectThresholdDays,
    weightAccuracy: form.weightAccuracy,
    weightConfidence: form.weightConfidence,
    weightRecency: form.weightRecency,
    strongThreshold: form.strongThreshold,
    needsReviewThreshold: form.needsReviewThreshold,
  };
}

/** Manual interval ladder editor — add/remove/edit the day counts (FR-8.1). */
function ManualIntervalsEditor({
  intervals,
  onChange,
}: {
  intervals: number[];
  onChange: (next: number[]) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {intervals.map((value, index) => (
          <div key={index} className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              className="w-20"
              value={value}
              aria-label={`Interval ${index + 1} (days)`}
              onChange={(e) => {
                const next = [...intervals];
                next[index] = Math.max(1, Number(e.target.value) || 1);
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove interval ${index + 1}`}
              disabled={intervals.length <= 1}
              onClick={() => onChange(intervals.filter((_, i) => i !== index))}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...intervals, (intervals[intervals.length - 1] ?? 1) * 2])}
      >
        <Plus className="size-4" /> Add step
      </Button>
    </div>
  );
}

function toScoringSample(view: ScoringSampleView): ScoringSample {
  return {
    ...view,
    asOfDate: new Date(view.asOfDate),
    sessions: view.sessions.map((session) => ({ ...session, studiedOn: new Date(session.studiedOn) })),
  };
}

/**
 * Live preview of the proposed weights/thresholds on the user's busiest topic (FR-8.2). The
 * sample's scoring inputs are fetched once; every keystroke then re-scores it locally with the
 * same `scoreSample` the server uses — no request per change (R3 P-2).
 */
function WeightPreview({ form, saved }: { form: FormState; saved: FormState }): React.JSX.Element {
  const previewQuery = useQuery({
    queryKey: [...queryKeys.settings.detail(), 'preview-sample'],
    queryFn: () =>
      apiFetch('/me/settings/preview', settingsPreviewResponseSchema, {
        method: 'POST',
        body: {
          weightAccuracy: saved.weightAccuracy,
          weightConfidence: saved.weightConfidence,
          weightRecency: saved.weightRecency,
          strongThreshold: saved.strongThreshold,
          needsReviewThreshold: saved.needsReviewThreshold,
        },
      }),
  });
  const preview = previewQuery.data?.preview ?? null;
  const sample = useMemo(() => (preview ? toScoringSample(preview.sample) : null), [preview]);

  if (previewQuery.isPending) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (previewQuery.isError) {
    return <p className="text-sm text-muted-foreground">Preview unavailable: {describeError(previewQuery.error)}</p>;
  }
  if (!preview || !sample) {
    return <p className="text-sm text-muted-foreground">Log a session on any topic to see a live preview here.</p>;
  }

  const proposed = scoreSample(sample, {
    accuracy: form.weightAccuracy,
    confidence: form.weightConfidence,
    recency: form.weightRecency,
    strongThreshold: form.strongThreshold,
    needsReviewThreshold: form.needsReviewThreshold,
  });

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" aria-live="polite">
      <p className="text-muted-foreground">
        Effect on <strong className="text-foreground">{preview.topicName}</strong>:
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2">
          Current: {preview.current.score === null ? '\u2014' : Math.round(preview.current.score)}
          <HealthStatusBadge status={preview.current.healthStatus as HealthStatus} />
        </span>
        <span aria-hidden="true">&rarr;</span>
        <span className="flex items-center gap-2">
          Proposed: {proposed.score === null ? '\u2014' : Math.round(proposed.score)}
          <HealthStatusBadge status={proposed.healthStatus} />
        </span>
      </div>
    </div>
  );
}

/** Settings (FR-8.1, FR-8.2, delivery-plan.md P10). */
export default function SettingsPage(): React.JSX.Element {
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.detail(),
    queryFn: () => apiFetch('/me/settings', userSettingsResponseSchema),
  });
  const [form, setForm] = useState<FormState | null>(null);
  const errors = useFormErrors();
  const timezones = useMemo(() => allTimezones(), []);
  const deviceTimezone = browserTimezone();

  useEffect(() => {
    if (settingsQuery.data) {
      setForm(settingsQuery.data.settings);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (next: FormState) =>
      apiFetch('/me/settings', userSettingsResponseSchema, { method: 'PATCH', body: toRequest(next) }),
    onSuccess: async (data) => {
      await invalidations.afterSettingsWrite();
      setForm(data.settings);
      toast({ title: 'Settings saved' });
      toastSchedulesChanged(data.schedulesChanged);
    },
    onError: (err) => errors.setFromApi(err, 'Could not save settings'),
  });

  const resetMutation = useMutation({
    mutationFn: () => apiFetch('/me/settings/reset-scoring', userSettingsResponseSchema, { method: 'POST' }),
    onSuccess: async (data) => {
      await invalidations.afterSettingsWrite();
      setForm(data.settings);
      toast({ title: 'Scoring reset to defaults' });
    },
    onError: (err) => toast({ title: 'Could not reset scoring', description: describeError(err), variant: 'destructive' }),
  });

  if (settingsQuery.isPending || !form) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (settingsQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load settings: {describeError(settingsQuery.error)}
      </p>
    );
  }

  const weightSum = form.weightAccuracy + form.weightConfidence + form.weightRecency;
  const weightsValid = Math.abs(weightSum - 1) < 1e-6;
  const thresholdsValid = form.needsReviewThreshold < form.strongThreshold;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!weightsValid || !thresholdsValid) {
      return;
    }
    // The same schema the server validates with, so e.g. an unknown timezone is caught here.
    if (!errors.validate(updateUserSettingsRequestSchema, toRequest(form))) return;
    saveMutation.mutate(form);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Timezone, scheduling and scoring preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Timezone and day boundary (FR-5.9), default scheduling algorithm.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-timezone">Timezone (IANA)</Label>
            {/* A native combobox: type to filter the full list of zones the browser knows. */}
            <Input
              id="settings-timezone"
              list="settings-timezone-options"
              autoComplete="off"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              {...errors.fieldProps('timezone', 'settings-timezone')}
            />
            <datalist id="settings-timezone-options">
              {timezones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <FieldError inputId="settings-timezone" message={errors.errors.timezone} />
            {deviceTimezone && deviceTimezone !== form.timezone ? (
              <button
                type="button"
                className="w-fit text-left text-xs text-primary hover:underline"
                onClick={() => setForm({ ...form, timezone: deviceTimezone })}
              >
                Use this device&apos;s timezone ({deviceTimezone})
              </button>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-day-start">Day starts at (hour, 0-23)</Label>
            <Input
              id="settings-day-start"
              type="number"
              min={0}
              max={23}
              value={form.dayStartHour}
              onChange={(e) => setForm({ ...form, dayStartHour: Number(e.target.value) })}
              {...errors.fieldProps('dayStartHour', 'settings-day-start')}
            />
            <FieldError inputId="settings-day-start" message={errors.errors.dayStartHour} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-algorithm">Default scheduling algorithm</Label>
            <Select
              value={form.defaultAlgorithm}
              onValueChange={(v) => setForm({ ...form, defaultAlgorithm: v as Algorithm })}
            >
              <SelectTrigger id="settings-algorithm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ALGORITHM_LABELS) as Algorithm[]).map((algorithm) => (
                  <SelectItem key={algorithm} value={algorithm}>
                    {ALGORITHM_LABELS[algorithm]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-neglect">Neglected after (days with no review)</Label>
            <Input
              id="settings-neglect"
              type="number"
              min={1}
              value={form.neglectThresholdDays}
              onChange={(e) => setForm({ ...form, neglectThresholdDays: Number(e.target.value) })}
              {...errors.fieldProps('neglectThresholdDays', 'settings-neglect')}
            />
            <FieldError inputId="settings-neglect" message={errors.errors.neglectThresholdDays} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual algorithm ladder</CardTitle>
          <CardDescription>Interval steps (days) used by the Manual scheduling algorithm.</CardDescription>
        </CardHeader>
        <CardContent>
          <ManualIntervalsEditor
            intervals={form.manualIntervals}
            onChange={(manualIntervals) => setForm({ ...form, manualIntervals })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Scoring weights &amp; health thresholds</CardTitle>
            <CardDescription>Weights must sum to 1.0 (FR-8.2). See the effect below before saving.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
            <RotateCcw className="size-4" /> Reset to defaults
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-weight-accuracy">Accuracy weight</Label>
              <Input
                id="settings-weight-accuracy"
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={form.weightAccuracy}
                onChange={(e) => setForm({ ...form, weightAccuracy: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-weight-confidence">Confidence weight</Label>
              <Input
                id="settings-weight-confidence"
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={form.weightConfidence}
                onChange={(e) => setForm({ ...form, weightConfidence: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-weight-recency">Recency weight</Label>
              <Input
                id="settings-weight-recency"
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={form.weightRecency}
                onChange={(e) => setForm({ ...form, weightRecency: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className={weightsValid ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'} role={weightsValid ? undefined : 'alert'}>
            Sum: {weightSum.toFixed(2)} {weightsValid ? '' : '(must equal 1.00)'}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-strong">Strong threshold (score \u2265)</Label>
              <Input
                id="settings-strong"
                type="number"
                min={0}
                max={100}
                value={form.strongThreshold}
                onChange={(e) => setForm({ ...form, strongThreshold: Number(e.target.value) })}
                {...errors.fieldProps('strongThreshold', 'settings-strong')}
              />
              <FieldError inputId="settings-strong" message={errors.errors.strongThreshold} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-needs-review">Needs-review threshold (score below)</Label>
              <Input
                id="settings-needs-review"
                type="number"
                min={0}
                max={100}
                value={form.needsReviewThreshold}
                onChange={(e) => setForm({ ...form, needsReviewThreshold: Number(e.target.value) })}
                {...errors.fieldProps('needsReviewThreshold', 'settings-needs-review')}
              />
              <FieldError inputId="settings-needs-review" message={errors.errors.needsReviewThreshold} />
            </div>
          </div>
          {!thresholdsValid ? (
            <p role="alert" className="text-sm text-destructive">
              The needs-review threshold must be lower than the strong threshold.
            </p>
          ) : null}

          <WeightPreview form={form} saved={settingsQuery.data.settings} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <FormError message={errors.formError} />
        <Button type="submit" className="w-fit" disabled={saveMutation.isPending || !weightsValid || !thresholdsValid}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

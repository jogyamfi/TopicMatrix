import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  healthStatusSchema,
  reviewStartResponseSchema,
  subjectsListResponseSchema,
  tagsListResponseSchema,
  type ReviewStartRequest,
} from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { startLauncherRun } from '../../lib/launcher-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

type PickableMode = 'dueToday' | 'weakest' | 'subject';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixes the mode to a specific subject or topic subtree, hiding the generic mode picker \u2014
   * used by the "Review this subject/topic" entry points on the subject tree and topic pages. */
  fixedScope?: { mode: 'subject'; subjectId: string; label: string } | { mode: 'topicSubtree'; topicId: string; label: string };
}

/**
 * Study Session Launcher's configuration step (FR-6.1, FR-6.2, FR-6.4, delivery-plan.md P8 task
 * 2/5) \u2014 picks a scope (or uses a fixed one passed in), optional secondary filters and session
 * caps, calls `POST /review/start`, then hands the ordered result to the launcher run store and
 * navigates to `/review/launch`.
 */
export function LaunchReviewDialog({ open, onOpenChange, fixedScope }: Props): React.JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<PickableMode>('dueToday');
  const [subjectId, setSubjectId] = useState('');
  const [tagId, setTagId] = useState('');
  const [healthStatus, setHealthStatus] = useState('');
  const [notReviewedInDays, setNotReviewedInDays] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [maxItems, setMaxItems] = useState('');
  const [targetMinutes, setTargetMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const subjectsQuery = useQuery({
    queryKey: queryKeys.subjects.list(),
    queryFn: () => apiFetch('/subjects', subjectsListResponseSchema),
    enabled: open && !fixedScope,
  });
  const tagsQuery = useQuery({
    queryKey: queryKeys.tags.list(),
    queryFn: () => apiFetch('/tags', tagsListResponseSchema),
    enabled: open,
  });

  const startMutation = useMutation({
    mutationFn: (body: ReviewStartRequest) =>
      apiFetch('/review/start', reviewStartResponseSchema, { method: 'POST', body }),
    onSuccess: (data) => {
      if (data.items.length === 0) {
        setError('No topics match this filter.');
        return;
      }
      startLauncherRun(data.items);
      onOpenChange(false);
      navigate('/review/launch');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not start a review session'),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const effectiveMode = fixedScope?.mode ?? mode;
    if (effectiveMode === 'subject' && !fixedScope && subjectId.length === 0) {
      setError('Choose a subject');
      return;
    }

    const body: ReviewStartRequest = {
      mode: effectiveMode,
      ...(fixedScope?.mode === 'subject' ? { subjectId: fixedScope.subjectId } : {}),
      ...(fixedScope?.mode === 'topicSubtree' ? { topicId: fixedScope.topicId } : {}),
      ...(!fixedScope && mode === 'subject' ? { subjectId } : {}),
      ...(tagId ? { tagId } : {}),
      ...(healthStatusSchema.safeParse(healthStatus).success ? { healthStatus: healthStatus as ReviewStartRequest['healthStatus'] } : {}),
      ...(notReviewedInDays ? { notReviewedInDays: Number.parseInt(notReviewedInDays, 10) } : {}),
      ...(minScore ? { minScore: Number.parseInt(minScore, 10) } : {}),
      ...(maxScore ? { maxScore: Number.parseInt(maxScore, 10) } : {}),
      ...(maxItems ? { maxItems: Number.parseInt(maxItems, 10) } : {}),
      ...(targetMinutes ? { targetMinutes: Number.parseInt(targetMinutes, 10) } : {}),
    };
    startMutation.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Start a review session</DialogTitle>
            <DialogDescription>
              {fixedScope ? `Reviewing ${fixedScope.label}.` : 'Choose what to review, then go one topic at a time.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {!fixedScope ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-mode">Review</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as PickableMode)}>
                  <SelectTrigger id="launch-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dueToday">Due today (overdue + due)</SelectItem>
                    <SelectItem value="weakest">Weakest topics first</SelectItem>
                    <SelectItem value="subject">A specific subject</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {!fixedScope && mode === 'subject' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-subject">Subject</Label>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger id="launch-subject">
                    <SelectValue placeholder="Choose a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {(subjectsQuery.data?.subjects ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-tag">Tag (optional)</Label>
                <Select value={tagId} onValueChange={setTagId}>
                  <SelectTrigger id="launch-tag">
                    <SelectValue placeholder="Any tag" />
                  </SelectTrigger>
                  <SelectContent>
                    {(tagsQuery.data?.tags ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-health">Health status (optional)</Label>
                <Select value={healthStatus} onValueChange={setHealthStatus}>
                  <SelectTrigger id="launch-health">
                    <SelectValue placeholder="Any status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="atRisk">At risk</SelectItem>
                    <SelectItem value="needsReview">Needs review</SelectItem>
                    <SelectItem value="strong">Strong</SelectItem>
                    <SelectItem value="notStarted">Not started</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-not-reviewed">Not reviewed in (days)</Label>
                <Input
                  id="launch-not-reviewed"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={notReviewedInDays}
                  onChange={(e) => setNotReviewedInDays(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-min-score">Min score</Label>
                <Input
                  id="launch-min-score"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-max-score">Max score</Label>
                <Input
                  id="launch-max-score"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-max-items">Cap by item count (optional)</Label>
                <Input
                  id="launch-max-items"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={maxItems}
                  onChange={(e) => setMaxItems(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="launch-target-minutes">Cap by target minutes (optional)</Label>
                <Input
                  id="launch-target-minutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={targetMinutes}
                  onChange={(e) => setTargetMinutes(e.target.value)}
                />
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={startMutation.isPending}>
              {startMutation.isPending ? 'Starting…' : 'Start review'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

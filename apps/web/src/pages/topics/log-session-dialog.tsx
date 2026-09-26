import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  sessionPreviewResponseSchema,
  sessionResponseSchema,
} from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { useUserToday } from '../../lib/use-user-today';
import { toast } from '../../lib/toast-store';
import { ConfidenceScale } from '../../components/confidence-scale';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

const GRADE_LABELS: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

interface Props {
  topic: { id: string; subjectId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  /** P8 launcher hook: called after a session is successfully logged, before the dialog closes. */
  onLogged?: () => void;
}

/**
 * Log Session form (FR-4.5, FR-5.4, delivery-plan.md P7 task 6) — optimised to be fast: date and
 * topic are pre-filled, notes are collapsed by default, confidence is a labelled 1-5 control, and
 * the computed grade is shown live with an override. Submitting the form (Enter) is the only
 * required interaction beyond filling in the two question counts and picking confidence.
 */
export function LogSessionDialog({ topic, onOpenChange, onLogged }: Props): React.JSX.Element {
  const today = useUserToday();
  // `null` = the user hasn't picked a date, so the session is for "today" — and today is left
  // for the server to resolve (timezone + dayStartHour, FR-5.9) rather than sent from here.
  const [studiedOn, setStudiedOn] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [questionsAttempted, setQuestionsAttempted] = useState('');
  const [questionsCorrect, setQuestionsCorrect] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [durationMinutes, setDurationMinutes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [gradeOverride, setGradeOverride] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topic) return;
    setStudiedOn(null);
    setSourceLabel('');
    setQuestionsAttempted('');
    setQuestionsCorrect('');
    setConfidence(3);
    setDurationMinutes('');
    setShowNotes(false);
    setNotes('');
    setGradeOverride(null);
    setError(null);
    // Keyed on the id, not the object: callers pass a fresh `{ id, subjectId, name }` literal on
    // every render, and resetting on identity would wipe the form whenever the parent re-renders
    // (e.g. a launcher snooze resolving while the user is typing).
  }, [topic?.id]);

  const attempted = Number.parseInt(questionsAttempted, 10);
  const correct = Number.parseInt(questionsCorrect, 10);
  const previewValid =
    Number.isInteger(attempted) && attempted >= 1 && Number.isInteger(correct) && correct >= 0 && correct <= attempted;

  const previewQuery = useQuery({
    queryKey: ['session-preview', topic?.id, attempted, correct, confidence],
    queryFn: () =>
      apiFetch(`/topics/${topic?.id}/sessions/preview`, sessionPreviewResponseSchema, {
        method: 'POST',
        body: { questionsAttempted: attempted, questionsCorrect: correct, confidence },
      }),
    enabled: topic !== null && previewValid,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      // The wire format is the schema's pre-transform shape (studiedOn as a plain YYYY-MM-DD
      // string) — CreateStudySessionRequest is the POST-transform (Date) type, so it isn't used
      // for this literal (see repo memory's parseJsonBody note on transform()-based schemas).
      const body = {
        ...(studiedOn !== null ? { studiedOn } : {}),
        sourceLabel: sourceLabel.trim().length > 0 ? sourceLabel : null,
        questionsAttempted: attempted,
        questionsCorrect: correct,
        confidence,
        durationMinutes: durationMinutes.trim().length > 0 ? Number.parseInt(durationMinutes, 10) : null,
        notes: notes.trim().length > 0 ? notes : null,
        gradeUsed: gradeOverride,
      };
      return apiFetch(`/topics/${topic?.id}/sessions`, sessionResponseSchema, { method: 'POST', body });
    },
    onSuccess: async () => {
      if (topic) await invalidations.afterSessionWrite(topic.subjectId, topic.id);
      toast({ title: 'Session logged' });
      onLogged?.();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not log session');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!previewValid) {
      setError('Enter a valid number of questions attempted and correct');
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog open={topic !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Log session — {topic?.name}</DialogTitle>
            <DialogDescription>Record the outcome of a study or quiz session.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-date">Date</Label>
                <Input
                  id="session-date"
                  type="date"
                  required
                  max={today}
                  value={studiedOn ?? today}
                  onChange={(e) => setStudiedOn(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-source">Source (optional)</Label>
                <Input
                  id="session-source"
                  placeholder="e.g. 2019 Paper 2"
                  value={sourceLabel}
                  onChange={(e) => setSourceLabel(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-attempted">Questions attempted</Label>
                <Input
                  id="session-attempted"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  autoFocus
                  value={questionsAttempted}
                  onChange={(e) => setQuestionsAttempted(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-correct">Questions correct</Label>
                <Input
                  id="session-correct"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  required
                  value={questionsCorrect}
                  onChange={(e) => setQuestionsCorrect(e.target.value)}
                />
              </div>
            </div>
            {previewValid ? (
              <p className="text-sm text-muted-foreground">Accuracy: {Math.round((correct / attempted) * 100)}%</p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label>Confidence</Label>
              <ConfidenceScale value={confidence} onChange={setConfidence} />
            </div>
            {previewQuery.data ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted p-2 text-sm">
                <span className="text-muted-foreground">Computed grade:</span>
                {[1, 2, 3, 4].map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => setGradeOverride(grade === previewQuery.data?.grade ? null : grade)}
                    aria-pressed={(gradeOverride ?? previewQuery.data?.grade) === grade}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      (gradeOverride ?? previewQuery.data?.grade) === grade
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background'
                    }`}
                  >
                    {GRADE_LABELS[grade]}
                  </button>
                ))}
                {gradeOverride !== null ? <span className="text-xs text-muted-foreground">(overridden)</span> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="session-duration">Duration in minutes (optional)</Label>
              <Input
                id="session-duration"
                type="number"
                inputMode="numeric"
                min={0}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </div>
            {showNotes ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-notes">Notes</Label>
                <Textarea id="session-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNotes(true)}
                className="w-fit text-sm text-primary hover:underline"
              >
                + Add notes
              </button>
            )}
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
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Log session'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

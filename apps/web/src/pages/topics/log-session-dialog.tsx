import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { computeGrade } from '@topicmatrix/core';
import {
  createStudySessionRequestSchema,
  sessionResponseSchema,
  type StudySessionView,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { useUserToday } from '../../lib/use-user-today';
import { useFormErrors } from '../../lib/form-errors';
import { toast } from '../../lib/toast-store';
import { ConfidenceScale } from '../../components/confidence-scale';
import { FieldError, FormError } from '../../components/field-error';
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
  /** P8 launcher hook: called with the saved session after a successful log, before the dialog closes. */
  onLogged?: (session: StudySessionView) => void;
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
  const form = useFormErrors();
  const { clear: clearErrors } = form;

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
    clearErrors();
    // Keyed on the id, not the object: callers pass a fresh `{ id, subjectId, name }` literal on
    // every render, and resetting on identity would wipe the form whenever the parent re-renders
    // (e.g. a launcher snooze resolving while the user is typing).
  }, [topic?.id, clearErrors]);

  const attempted = Number.parseInt(questionsAttempted, 10);
  const correct = Number.parseInt(questionsCorrect, 10);
  const countsValid =
    Number.isInteger(attempted) && attempted >= 1 && Number.isInteger(correct) && correct >= 0 && correct <= attempted;
  // Computed locally (pure, packages/core): the same mapping the server applies, with no request
  // per keystroke. `POST /topics/:id/sessions/preview` stays for API consumers.
  const computedGrade = countsValid ? computeGrade(correct / attempted, confidence) : null;

  const createMutation = useMutation({
    // The wire format is the schema's pre-transform shape (studiedOn as a plain YYYY-MM-DD
    // string) — CreateStudySessionRequest is the POST-transform (Date) type.
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/topics/${topic?.id}/sessions`, sessionResponseSchema, { method: 'POST', body }),
    onSuccess: async (data) => {
      if (topic) await invalidations.afterSessionWrite(topic.subjectId, topic.id);
      toast({ title: 'Session logged' });
      onLogged?.(data.session);
      onOpenChange(false);
    },
    onError: (err) => form.setFromApi(err, 'Could not log session'),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
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
    // The same schema the server validates with, so obvious mistakes never make a round trip.
    if (!form.validate(createStudySessionRequestSchema, body)) return;
    createMutation.mutate(body);
  };

  return (
    <Dialog open={topic !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* noValidate: our own messages (next to each field) replace the browser's popups. */}
        <form onSubmit={handleSubmit} noValidate>
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
                  {...form.fieldProps('studiedOn', 'session-date')}
                />
                <FieldError inputId="session-date" message={form.errors.studiedOn} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="session-source">Source (optional)</Label>
                <Input
                  id="session-source"
                  placeholder="e.g. 2019 Paper 2"
                  value={sourceLabel}
                  onChange={(e) => setSourceLabel(e.target.value)}
                  {...form.fieldProps('sourceLabel', 'session-source')}
                />
                <FieldError inputId="session-source" message={form.errors.sourceLabel} />
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
                  {...form.fieldProps('questionsAttempted', 'session-attempted')}
                />
                <FieldError inputId="session-attempted" message={form.errors.questionsAttempted} />
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
                  {...form.fieldProps('questionsCorrect', 'session-correct')}
                />
                <FieldError inputId="session-correct" message={form.errors.questionsCorrect} />
              </div>
            </div>
            {countsValid ? (
              <p className="text-sm text-muted-foreground">Accuracy: {Math.round((correct / attempted) * 100)}%</p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label>Confidence</Label>
              <ConfidenceScale value={confidence} onChange={setConfidence} />
            </div>
            {computedGrade !== null ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted p-2 text-sm">
                <span className="text-muted-foreground">Computed grade:</span>
                {[1, 2, 3, 4].map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => setGradeOverride(grade === computedGrade ? null : grade)}
                    aria-pressed={(gradeOverride ?? computedGrade) === grade}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      (gradeOverride ?? computedGrade) === grade
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
                {...form.fieldProps('durationMinutes', 'session-duration')}
              />
              <FieldError inputId="session-duration" message={form.errors.durationMinutes} />
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
            <FormError message={form.formError} />
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

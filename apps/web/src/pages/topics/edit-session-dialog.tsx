import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sessionResponseSchema, type StudySessionView } from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
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

interface Props {
  session: StudySessionView | null;
  subjectId: string;
  onOpenChange: (open: boolean) => void;
}

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

/** Inline edit for a logged session (FR-4.6) — every edit re-triggers schedule recalculation
 * server-side, so the whole subject tree's scores are invalidated on save. */
export function EditSessionDialog({ session, subjectId, onOpenChange }: Props): React.JSX.Element {
  const [studiedOn, setStudiedOn] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [questionsAttempted, setQuestionsAttempted] = useState('');
  const [questionsCorrect, setQuestionsCorrect] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [durationMinutes, setDurationMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setStudiedOn(toIsoDate(session.studiedOn));
    setSourceLabel(session.sourceLabel ?? '');
    setQuestionsAttempted(String(session.questionsAttempted));
    setQuestionsCorrect(String(session.questionsCorrect));
    setConfidence(session.confidence);
    setDurationMinutes(session.durationMinutes !== null ? String(session.durationMinutes) : '');
    setNotes(session.notes ?? '');
    setError(null);
  }, [session]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const attempted = Number.parseInt(questionsAttempted, 10);
      const correct = Number.parseInt(questionsCorrect, 10);
      // Wire format is pre-transform (studiedOn as a plain string) — see log-session-dialog.tsx's
      // identical note.
      const body = {
        studiedOn,
        sourceLabel: sourceLabel.trim().length > 0 ? sourceLabel : null,
        questionsAttempted: attempted,
        questionsCorrect: correct,
        confidence,
        durationMinutes: durationMinutes.trim().length > 0 ? Number.parseInt(durationMinutes, 10) : null,
        notes: notes.trim().length > 0 ? notes : null,
      };
      return apiFetch(`/sessions/${session?.id}`, sessionResponseSchema, { method: 'PATCH', body });
    },
    onSuccess: async () => {
      if (session) await invalidations.afterSessionWrite(subjectId, session.topicId);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save session');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    saveMutation.mutate();
  };

  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit session</DialogTitle>
            <DialogDescription>Saving recalculates this topic's schedule and score.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-session-date">Date</Label>
                <Input id="edit-session-date" type="date" required value={studiedOn} onChange={(e) => setStudiedOn(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-session-source">Source</Label>
                <Input id="edit-session-source" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-session-attempted">Questions attempted</Label>
                <Input
                  id="edit-session-attempted"
                  type="number"
                  min={1}
                  required
                  value={questionsAttempted}
                  onChange={(e) => setQuestionsAttempted(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-session-correct">Questions correct</Label>
                <Input
                  id="edit-session-correct"
                  type="number"
                  min={0}
                  required
                  value={questionsCorrect}
                  onChange={(e) => setQuestionsCorrect(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Confidence</Label>
              <ConfidenceScale value={confidence} onChange={setConfidence} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-session-duration">Duration in minutes</Label>
              <Input
                id="edit-session-duration"
                type="number"
                min={0}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-session-notes">Notes</Label>
              <Textarea id="edit-session-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

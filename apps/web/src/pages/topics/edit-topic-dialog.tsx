import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { topicResponseSchema, type Algorithm, type TopicView, type UpdateTopicRequest } from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

const ALGORITHM_LABELS: Record<Algorithm, string> = { fsrs: 'FSRS', sm2: 'SM-2', manual: 'Manual' };

interface Props {
  topic: TopicView | null;
  onOpenChange: (open: boolean) => void;
}

/** Edit-topic dialog — name, notes, algorithm override, and the topic-level suspended flag
 * (FR-3.*, P7 task 8). */
export function EditTopicDialog({ topic, onOpenChange }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [algorithmOverride, setAlgorithmOverride] = useState<Algorithm | 'inherit'>('inherit');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topic) return;
    setName(topic.name);
    setNotes(topic.notes ?? '');
    setAlgorithmOverride((topic.algorithmOverride as Algorithm | null) ?? 'inherit');
    setError(null);
  }, [topic]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: UpdateTopicRequest = {
        name,
        notes: notes.trim().length > 0 ? notes : null,
        algorithmOverride: algorithmOverride === 'inherit' ? null : algorithmOverride,
      };
      return apiFetch(`/topics/${topic?.id}`, topicResponseSchema, { method: 'PATCH', body });
    },
    onSuccess: async (data) => {
      if (topic) await invalidations.afterTopicWrite(topic.subjectId);
      if (data.scheduleChanged) {
        toast({ title: 'Algorithm changed', description: 'This topic\u2019s next review date has been recalculated.' });
      }
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save topic');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    saveMutation.mutate();
  };

  return (
    <Dialog open={topic !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit topic</DialogTitle>
            <DialogDescription>Changing the algorithm re-derives the schedule from history.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-topic-name">Name</Label>
              <Input id="edit-topic-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-topic-notes">Notes</Label>
              <Textarea id="edit-topic-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-topic-algorithm">Algorithm</Label>
              <Select
                value={algorithmOverride}
                onValueChange={(v) => setAlgorithmOverride(v as Algorithm | 'inherit')}
              >
                <SelectTrigger id="edit-topic-algorithm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit from subject/user default</SelectItem>
                  {(Object.keys(ALGORITHM_LABELS) as Algorithm[]).map((algorithm) => (
                    <SelectItem key={algorithm} value={algorithm}>
                      {ALGORITHM_LABELS[algorithm]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

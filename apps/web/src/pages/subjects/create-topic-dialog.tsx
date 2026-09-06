import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { topicResponseSchema, type Algorithm, type CreateTopicRequest } from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
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
  subjectId: string;
  /** `null` creates a top-level topic. */
  parentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Create-topic dialog (FR-3.1) — used for both "add root topic" and "add child" (P7 task 2). */
export function CreateTopicDialog({ subjectId, parentId, open, onOpenChange }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [algorithmOverride, setAlgorithmOverride] = useState<Algorithm | 'inherit'>('inherit');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setAlgorithmOverride('inherit');
    setError(null);
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () => {
      const body: CreateTopicRequest = {
        subjectId,
        parentId,
        name,
        algorithmOverride: algorithmOverride === 'inherit' ? null : algorithmOverride,
      };
      return apiFetch('/topics', topicResponseSchema, { method: 'POST', body });
    },
    onSuccess: async () => {
      await invalidations.afterTopicWrite(subjectId);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not create topic');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{parentId ? 'New sub-topic' : 'New topic'}</DialogTitle>
            <DialogDescription>
              {parentId ? 'Added as a child of the selected topic.' : 'Added at the top level of this subject.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="topic-name">Name</Label>
              <Input
                id="topic-name"
                required
                autoFocus
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="topic-algorithm">Algorithm</Label>
              <Select
                value={algorithmOverride}
                onValueChange={(v) => setAlgorithmOverride(v as Algorithm | 'inherit')}
              >
                <SelectTrigger id="topic-algorithm">
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
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create topic'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

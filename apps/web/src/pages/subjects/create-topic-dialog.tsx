import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  createTopicRequestSchema,
  topicResponseSchema,
  type Algorithm,
  type CreateTopicRequest,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { useFormErrors } from '../../lib/form-errors';
import { FieldError, FormError } from '../../components/field-error';
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
  const form = useFormErrors();
  const { clear: clearErrors } = form;

  useEffect(() => {
    if (!open) return;
    setName('');
    setAlgorithmOverride('inherit');
    clearErrors();
  }, [open, clearErrors]);

  const createMutation = useMutation({
    mutationFn: (body: CreateTopicRequest) => apiFetch('/topics', topicResponseSchema, { method: 'POST', body }),
    onSuccess: async () => {
      await invalidations.afterTopicWrite(subjectId);
      onOpenChange(false);
    },
    onError: (err) => form.setFromApi(err, 'Could not create topic'),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const body: CreateTopicRequest = {
      subjectId,
      parentId,
      name,
      algorithmOverride: algorithmOverride === 'inherit' ? null : algorithmOverride,
    };
    if (!form.validate(createTopicRequestSchema, body)) return;
    createMutation.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate>
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
                {...form.fieldProps('name', 'topic-name')}
              />
              <FieldError inputId="topic-name" message={form.errors.name} />
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
            <FormError message={form.formError} />
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

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  subjectResponseSchema,
  type Algorithm,
  type CreateSubjectRequest,
  type SubjectView,
} from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { cn } from '../../lib/utils';
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
import { SUBJECT_COLOURS, SUBJECT_ICONS } from './subject-appearance';

interface Props {
  /** `null` creates a new subject; a value edits it in place (P7 task 1). */
  subject: SubjectView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ALGORITHM_LABELS: Record<Algorithm, string> = { fsrs: 'FSRS', sm2: 'SM-2', manual: 'Manual' };

export function SubjectDialog({ subject, open, onOpenChange }: Props): React.JSX.Element {
  const isEdit = subject !== null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [colour, setColour] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [defaultAlgorithm, setDefaultAlgorithm] = useState<Algorithm | 'inherit'>('inherit');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(subject?.name ?? '');
    setDescription(subject?.description ?? '');
    setColour(subject?.colour ?? null);
    setIcon(subject?.icon ?? null);
    setDefaultAlgorithm(subject?.defaultAlgorithm ?? 'inherit');
    setError(null);
  }, [open, subject]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: CreateSubjectRequest = {
        name,
        description: description.trim().length > 0 ? description : null,
        colour,
        icon,
        defaultAlgorithm: defaultAlgorithm === 'inherit' ? null : defaultAlgorithm,
      };
      return subject !== null
        ? apiFetch(`/subjects/${subject.id}`, subjectResponseSchema, { method: 'PATCH', body })
        : apiFetch('/subjects', subjectResponseSchema, { method: 'POST', body });
    },
    onSuccess: async () => {
      await invalidations.afterSubjectWrite();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save subject');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit subject' : 'New subject'}</DialogTitle>
            <DialogDescription>
              {isEdit ? 'Update this subject.' : 'A subject holds a tree of topics you can log study sessions against.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject-name">Name</Label>
              <Input
                id="subject-name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject-description">Description</Label>
              <Textarea
                id="subject-description"
                maxLength={2000}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label="No colour"
                  aria-pressed={colour === null}
                  onClick={() => setColour(null)}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border text-xs text-muted-foreground',
                    colour === null && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                >
                  ×
                </button>
                {SUBJECT_COLOURS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Colour ${swatch}`}
                    aria-pressed={colour === swatch}
                    onClick={() => setColour(swatch)}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      'size-7 rounded-full border',
                      colour === swatch && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label="No icon"
                  aria-pressed={icon === null}
                  onClick={() => setIcon(null)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-md border text-sm text-muted-foreground',
                    icon === null && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                >
                  ×
                </button>
                {SUBJECT_ICONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Icon ${emoji}`}
                    aria-pressed={icon === emoji}
                    onClick={() => setIcon(emoji)}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-md border text-lg',
                      icon === emoji && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject-algorithm">Default algorithm</Label>
              <Select
                value={defaultAlgorithm}
                onValueChange={(v) => setDefaultAlgorithm(v as Algorithm | 'inherit')}
              >
                <SelectTrigger id="subject-algorithm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit from user settings</SelectItem>
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
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create subject'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { statusResponseSchema, type SubjectView } from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

interface Props {
  subject: SubjectView | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

/** Delete-subject dialog with typed-name confirmation (FR-2.4) — cascades topics, sessions,
 * schedules and snapshots (packages/db/src/subject-deletion.ts). */
export function DeleteSubjectDialog({ subject, onOpenChange, onDeleted }: Props): React.JSX.Element {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirmText('');
    setError(null);
  }, [subject?.id]);

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/subjects/${subject?.id}`, statusResponseSchema, {
        method: 'DELETE',
        body: { confirm: true },
      }),
    onSuccess: async () => {
      await invalidations.afterSubjectDelete();
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not delete subject');
    },
  });

  const matches = subject !== null && confirmText === subject.name;

  return (
    <Dialog open={subject !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {subject?.name}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the subject, every topic in it, and all logged study
            sessions, schedules and history for those topics. Type{' '}
            <span className="font-semibold">{subject?.name}</span> to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 py-2">
          <Label htmlFor="confirm-delete-subject">Subject name</Label>
          <Input
            id="confirm-delete-subject"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete subject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

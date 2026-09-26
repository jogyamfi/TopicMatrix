import { useMutation } from '@tanstack/react-query';
import { sessionDeleteResponseSchema, type StudySessionView } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../../lib/api-error';
import { Button } from '../../components/ui/button';
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

export function DeleteSessionDialog({ session, subjectId, onOpenChange }: Props): React.JSX.Element {
  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/sessions/${session?.id}`, sessionDeleteResponseSchema, { method: 'DELETE' }),
    onSuccess: async () => {
      if (session) await invalidations.afterSessionWrite(subjectId, session.topicId);
      toast({ title: 'Session deleted' });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: 'Could not delete session',
        description: describeError(err),
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this session?</DialogTitle>
          <DialogDescription>
            This recalculates the topic's schedule and score from the remaining history.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            {deleteMutation.isPending ? 'Deleting…' : 'Delete session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

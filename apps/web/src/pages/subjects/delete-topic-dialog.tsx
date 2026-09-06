import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { statusResponseSchema, type TopicDeleteMode, type TopicTreeNodeView } from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { cn } from '../../lib/utils';
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
  topic: TopicTreeNodeView | null;
  subjectId: string;
  onOpenChange: (open: boolean) => void;
}

function countDescendants(node: TopicTreeNodeView): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

/** Delete-topic dialog offering cascade vs promote (FR-3.6, P7 task 5). */
export function DeleteTopicDialog({ topic, subjectId, onOpenChange }: Props): React.JSX.Element {
  const [mode, setMode] = useState<TopicDeleteMode>('promote');
  const [error, setError] = useState<string | null>(null);
  const descendantCount = topic ? countDescendants(topic) : 0;

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/topics/${topic?.id}`, statusResponseSchema, { method: 'DELETE', body: { mode } }),
    onSuccess: async () => {
      await invalidations.afterTopicWrite(subjectId);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not delete topic');
    },
  });

  return (
    <Dialog
      open={topic !== null}
      onOpenChange={(next) => {
        if (next) return;
        setMode('promote');
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {topic?.name}?</DialogTitle>
          <DialogDescription>
            {descendantCount > 0
              ? `This topic has ${descendantCount} sub-topic${descendantCount === 1 ? '' : 's'} beneath it.`
              : 'This topic has no sub-topics.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <button
            type="button"
            onClick={() => setMode('promote')}
            className={cn('rounded-md border p-3 text-left text-sm', mode === 'promote' && 'border-primary bg-accent')}
          >
            <p className="font-medium">Promote sub-topics</p>
            <p className="text-muted-foreground">
              Direct children move up to take this topic&apos;s place. Only this one topic and its own
              study sessions are deleted.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode('cascade')}
            className={cn('rounded-md border p-3 text-left text-sm', mode === 'cascade' && 'border-primary bg-accent')}
          >
            <p className="font-medium">Delete everything beneath it</p>
            <p className="text-muted-foreground">
              This topic and all {descendantCount} sub-topic{descendantCount === 1 ? '' : 's'} are deleted,
              along with every logged study session, schedule and history for all of them.
            </p>
          </button>
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
          <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            {deleteMutation.isPending ? 'Deleting…' : 'Delete topic'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

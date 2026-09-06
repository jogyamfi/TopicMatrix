import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  subjectTreeResponseSchema,
  subjectsListResponseSchema,
  topicResponseSchema,
  type TopicTreeNodeView,
} from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { Button } from '../../components/ui/button';
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

const ROOT = '__root__';

interface FlatOption {
  id: string;
  label: string;
  disabled: boolean;
}

/** Excludes the topic being moved and its own descendants (a client-side head start on FR-3.4's
 * cycle rejection — the server is still the source of truth, via TOPIC_CYCLE). */
function flattenExcluding(nodes: readonly TopicTreeNodeView[], excludeId: string | undefined): FlatOption[] {
  const options: FlatOption[] = [];

  function visit(node: TopicTreeNodeView, depth: number, ancestorExcluded: boolean): void {
    const excluded = ancestorExcluded || node.id === excludeId;
    options.push({ id: node.id, label: `${'—'.repeat(depth)} ${node.name}`.trim(), disabled: excluded });
    for (const child of node.children) visit(child, depth + 1, excluded);
  }

  for (const node of nodes) visit(node, 0, false);
  return options;
}

interface Props {
  topic: TopicTreeNodeView | null;
  currentSubjectId: string;
  onOpenChange: (open: boolean) => void;
}

/** Keyboard-accessible alternative to drag-and-drop re-parenting (NF-4, P7 task 3) — re-parents
 * a topic, including across subjects (FR-3.5), via two plain selects. */
export function MoveTopicDialog({ topic, currentSubjectId, onOpenChange }: Props): React.JSX.Element {
  const [targetSubjectId, setTargetSubjectId] = useState(currentSubjectId);
  const [targetParentId, setTargetParentId] = useState(ROOT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topic) return;
    setTargetSubjectId(currentSubjectId);
    setTargetParentId(topic.parentId ?? ROOT);
    setError(null);
  }, [topic, currentSubjectId]);

  const subjectsQuery = useQuery({
    queryKey: ['subjects-for-move'],
    queryFn: () => apiFetch('/subjects', subjectsListResponseSchema),
    enabled: topic !== null,
  });

  const targetTreeQuery = useQuery({
    queryKey: ['subject-tree-for-move', targetSubjectId],
    queryFn: () => apiFetch(`/subjects/${targetSubjectId}/tree`, subjectTreeResponseSchema),
    enabled: topic !== null && targetSubjectId.length > 0,
  });

  const options = targetTreeQuery.data
    ? flattenExcluding(targetTreeQuery.data.tree, targetSubjectId === currentSubjectId ? topic?.id : undefined)
    : [];

  const moveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/topics/${topic?.id}/move`, topicResponseSchema, {
        method: 'POST',
        body: {
          subjectId: targetSubjectId,
          parentId: targetParentId === ROOT ? null : targetParentId,
        },
      }),
    onSuccess: async () => {
      await Promise.all([invalidations.afterTopicWrite(currentSubjectId), invalidations.afterTopicWrite(targetSubjectId)]);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not move topic');
    },
  });

  return (
    <Dialog open={topic !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {topic?.name}</DialogTitle>
          <DialogDescription>Choose a new subject and parent topic.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-subject">Subject</Label>
            <Select
              value={targetSubjectId}
              onValueChange={(v) => {
                setTargetSubjectId(v);
                setTargetParentId(ROOT);
              }}
            >
              <SelectTrigger id="move-subject">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjectsQuery.data?.subjects.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-parent">New parent</Label>
            <Select value={targetParentId} onValueChange={setTargetParentId}>
              <SelectTrigger id="move-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT}>— Top level —</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id} disabled={option.disabled}>
                    {option.label}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={moveMutation.isPending} onClick={() => moveMutation.mutate()}>
            {moveMutation.isPending ? 'Moving…' : 'Move topic'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

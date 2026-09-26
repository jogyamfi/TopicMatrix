import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Plus, Rocket } from 'lucide-react';
import { subjectTreeResponseSchema, topicResponseSchema, type TopicTreeNodeView } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../admin/users-page';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/empty-state';
import { TopicTreeNodeRow } from './topic-tree-node';
import { CreateTopicDialog } from './create-topic-dialog';
import { DeleteTopicDialog } from './delete-topic-dialog';
import { MoveTopicDialog } from './move-topic-dialog';
import { LogSessionDialog } from '../topics/log-session-dialog';
import { LaunchReviewDialog } from '../review/launch-review-dialog';

function collapsedStorageKey(subjectId: string): string {
  return `topictree:collapsed:${subjectId}`;
}

function loadCollapsed(subjectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(collapsedStorageKey(subjectId));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/** Topic tree view (FR-3.*, delivery-plan.md P7 tasks 2-5) — recursive, expand/collapse state
 * persisted to localStorage, inline rename, drag-and-drop re-parenting with a keyboard-accessible
 * "Move to…" alternative (NF-4), and cascade/promote delete. */
export default function SubjectTreePage(): React.JSX.Element {
  const { subjectId } = useParams<{ subjectId: string }>();
  const id = subjectId ?? '';

  const treeQuery = useQuery({
    queryKey: queryKeys.subjects.tree(id),
    queryFn: () => apiFetch(`/subjects/${id}/tree`, subjectTreeResponseSchema),
    enabled: id.length > 0,
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(id));
  useEffect(() => {
    setCollapsed(loadCollapsed(id));
  }, [id]);
  useEffect(() => {
    localStorage.setItem(collapsedStorageKey(id), JSON.stringify([...collapsed]));
  }, [id, collapsed]);

  const toggleCollapsed = (topicId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };

  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<TopicTreeNodeView | null>(null);
  const [moveTarget, setMoveTarget] = useState<TopicTreeNodeView | null>(null);
  const [logTarget, setLogTarget] = useState<TopicTreeNodeView | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const move = async (topicId: string, body: { parentId?: string | null; position?: number }) => {
    try {
      await apiFetch(`/topics/${topicId}/move`, topicResponseSchema, { method: 'POST', body });
    } catch (err) {
      toast({ title: 'Could not move topic', description: describeError(err), variant: 'destructive' });
    }
  };

  const handleDropTopic = async (draggedId: string, newParentId: string) => {
    await move(draggedId, { parentId: newParentId });
    await invalidations.afterTopicWrite(id);
  };

  const handleDropOnRoot = async (draggedId: string) => {
    await move(draggedId, { parentId: null });
    await invalidations.afterTopicWrite(id);
  };

  const handleReorder = async (
    node: TopicTreeNodeView,
    siblings: readonly TopicTreeNodeView[],
    index: number,
    direction: 'up' | 'down',
  ) => {
    const position = direction === 'up' ? index - 1 : index + 1;
    if (position < 0 || position >= siblings.length) return;
    // One call: the server places the topic at `position` and renumbers the sibling group.
    await move(node.id, { position });
    await invalidations.afterTopicWrite(id);
  };

  const rootTopics = useMemo(() => treeQuery.data?.tree ?? [], [treeQuery.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon">
            <Link to="/subjects" aria-label="Back to subjects">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              {treeQuery.data?.subject.icon ? <span aria-hidden="true">{treeQuery.data.subject.icon}</span> : null}
              {treeQuery.data?.subject.name ?? 'Subject'}
            </h1>
            {treeQuery.data?.subject.description ? (
              <p className="text-sm text-muted-foreground">{treeQuery.data.subject.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setReviewOpen(true)}>
            <Rocket /> Review this subject
          </Button>
          <Button onClick={() => setCreateParentId(null)}>
            <Plus /> Add topic
          </Button>
        </div>
      </div>

      {treeQuery.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : treeQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load topic tree: {describeError(treeQuery.error)}
        </p>
      ) : rootTopics.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No topics yet"
          description="Add your first topic to start building this subject's tree."
          action={
            <Button onClick={() => setCreateParentId(null)}>
              <Plus /> Add topic
            </Button>
          }
        />
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId) void handleDropOnRoot(draggedId);
          }}
          className="rounded-lg border p-2"
        >
          <ul>
            {rootTopics.map((node, index) => (
              <TopicTreeNodeRow
                key={node.id}
                node={node}
                subjectId={id}
                siblings={rootTopics}
                index={index}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
                onReorder={handleReorder}
                onAddChild={(parentId) => setCreateParentId(parentId)}
                onDelete={setDeleteTarget}
                onMove={setMoveTarget}
                onLogSession={setLogTarget}
                onDropTopic={handleDropTopic}
              />
            ))}
          </ul>
        </div>
      )}

      <CreateTopicDialog
        subjectId={id}
        parentId={createParentId ?? null}
        open={createParentId !== undefined}
        onOpenChange={(open) => !open && setCreateParentId(undefined)}
      />
      <DeleteTopicDialog
        topic={deleteTarget}
        subjectId={id}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      />
      <MoveTopicDialog
        topic={moveTarget}
        currentSubjectId={id}
        onOpenChange={(open) => !open && setMoveTarget(null)}
      />
      <LogSessionDialog
        topic={logTarget ? { id: logTarget.id, subjectId: id, name: logTarget.name } : null}
        onOpenChange={(open) => !open && setLogTarget(null)}
      />
      <LaunchReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        fixedScope={{ mode: 'subject', subjectId: id, label: treeQuery.data?.subject.name ?? 'this subject' }}
      />
    </div>
  );
}

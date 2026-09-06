import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ListChecks, Pause, Play, Plus, X } from 'lucide-react';
import {
  createTagRequestSchema,
  historyResponseSchema,
  scheduleOverrideResponseSchema,
  scheduleResponseSchema,
  sessionsListResponseSchema,
  statusResponseSchema,
  tagResponseSchema,
  tagsListResponseSchema,
  topicResponseSchema,
  type StudySessionView,
  type TagView,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../admin/users-page';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { EditTopicDialog } from './edit-topic-dialog';
import { LogSessionDialog } from './log-session-dialog';
import { EditSessionDialog } from './edit-session-dialog';
import { DeleteSessionDialog } from './delete-session-dialog';
import { SessionHistoryTable } from './session-history-table';

function ScoreCard({ title, score, health }: { title: string; score: number | null; health: string | null }): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <span className="text-2xl font-semibold">{score === null ? '—' : Math.round(score)}</span>
        <HealthStatusBadge status={(health ?? 'notStarted') as HealthStatus} />
      </CardContent>
    </Card>
  );
}

function TagsSection({ topicId }: { topicId: string }): React.JSX.Element {
  const topicTagsQuery = useQuery({
    queryKey: queryKeys.topics.tags(topicId),
    queryFn: () => apiFetch(`/topics/${topicId}/tags`, tagsListResponseSchema),
  });
  const allTagsQuery = useQuery({
    queryKey: queryKeys.tags.list(),
    queryFn: () => apiFetch('/tags', tagsListResponseSchema),
  });
  const [newTagName, setNewTagName] = useState('');

  const attachMutation = useMutation({
    mutationFn: (tagId: string) =>
      apiFetch(`/topics/${topicId}/tags/${tagId}`, statusResponseSchema, { method: 'POST' }),
    onSuccess: () => invalidations.afterTopicTagsWrite(topicId),
    onError: (err) => toast({ title: 'Could not attach tag', description: describeError(err), variant: 'destructive' }),
  });

  const detachMutation = useMutation({
    mutationFn: (tagId: string) =>
      apiFetch(`/topics/${topicId}/tags/${tagId}`, statusResponseSchema, { method: 'DELETE' }),
    onSuccess: () => invalidations.afterTopicTagsWrite(topicId),
    onError: (err) => toast({ title: 'Could not remove tag', description: describeError(err), variant: 'destructive' }),
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => {
      createTagRequestSchema.parse({ name });
      return apiFetch('/tags', tagResponseSchema, { method: 'POST', body: { name } });
    },
    onSuccess: async (data) => {
      await invalidations.afterTagWrite();
      setNewTagName('');
      attachMutation.mutate(data.tag.id);
    },
    onError: (err) => toast({ title: 'Could not create tag', description: describeError(err), variant: 'destructive' }),
  });

  const attachedIds = new Set((topicTagsQuery.data?.tags ?? []).map((t) => t.id));
  const availableToAttach = (allTagsQuery.data?.tags ?? []).filter((t) => !attachedIds.has(t.id));

  const handleCreateTag = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newTagName.trim();
    if (trimmed.length === 0) return;
    const existing = allTagsQuery.data?.tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      attachMutation.mutate(existing.id);
      setNewTagName('');
    } else {
      createTagMutation.mutate(trimmed);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(topicTagsQuery.data?.tags ?? []).map((tag: TagView) => (
        <Badge key={tag.id} variant="secondary">
          {tag.name}
          <button
            type="button"
            aria-label={`Remove tag ${tag.name}`}
            onClick={() => detachMutation.mutate(tag.id)}
            className="ml-0.5"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {availableToAttach.length > 0 ? (
        <Select onValueChange={(tagId) => attachMutation.mutate(tagId)}>
          <SelectTrigger className="h-7 w-40">
            <SelectValue placeholder="Add existing tag" />
          </SelectTrigger>
          <SelectContent>
            {availableToAttach.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <form onSubmit={handleCreateTag} className="flex items-center gap-1">
        <input
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="New tag"
          className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs"
        />
        <Button type="submit" size="icon" variant="outline" className="size-7" aria-label="Add tag">
          <Plus className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}

/** Topic detail page (FR-3.*, FR-4.*, FR-5.*, delivery-plan.md P7 task 8). */
export default function TopicDetailPage(): React.JSX.Element {
  const { subjectId, topicId } = useParams<{ subjectId: string; topicId: string }>();
  const id = topicId ?? '';
  const subjId = subjectId ?? '';

  const topicQuery = useQuery({
    queryKey: queryKeys.topics.detail(id),
    queryFn: () => apiFetch(`/topics/${id}`, topicResponseSchema),
    enabled: id.length > 0,
  });
  const scheduleQuery = useQuery({
    queryKey: [...queryKeys.topics.detail(id), 'schedule'],
    queryFn: () => apiFetch(`/topics/${id}/schedule`, scheduleResponseSchema),
    enabled: id.length > 0,
  });
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(id),
    queryFn: () => apiFetch(`/topics/${id}/sessions`, sessionsListResponseSchema),
    enabled: id.length > 0,
  });
  // Retention-curve data source (FR-7.7) — fetched here only to confirm history exists; P9 owns
  // the actual chart.
  useQuery({
    queryKey: queryKeys.sessions.history(id),
    queryFn: () => apiFetch(`/topics/${id}/history`, historyResponseSchema),
    enabled: id.length > 0,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [editSession, setEditSession] = useState<StudySessionView | null>(null);
  const [deleteSession, setDeleteSession] = useState<StudySessionView | null>(null);

  const suspendMutation = useMutation({
    mutationFn: (suspended: boolean) =>
      apiFetch(`/topics/${id}/schedule/override`, scheduleOverrideResponseSchema, {
        method: 'POST',
        body: { action: 'suspend', suspended },
      }),
    onSuccess: async () => {
      await invalidations.afterSessionWrite(subjId, id);
    },
    onError: (err) => toast({ title: 'Could not update schedule', description: describeError(err), variant: 'destructive' }),
  });

  if (topicQuery.isPending) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (topicQuery.isError || !topicQuery.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load topic: {describeError(topicQuery.error)}
      </p>
    );
  }

  const topic = topicQuery.data.topic;
  const schedule = scheduleQuery.data?.schedule ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <Button asChild variant="ghost" size="icon">
            <Link to={`/subjects/${subjId}`} aria-label="Back to topic tree">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{topic.name}</h1>
            {topic.notes ? <p className="max-w-prose text-sm text-muted-foreground">{topic.notes}</p> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setLogOpen(true)}>
            <ListChecks /> Log session
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button
            variant="outline"
            disabled={suspendMutation.isPending}
            onClick={() => suspendMutation.mutate(!(schedule?.isSuspended ?? false))}
          >
            {schedule?.isSuspended ? (
              <>
                <Play /> Resume reviews
              </>
            ) : (
              <>
                <Pause /> Pause reviews
              </>
            )}
          </Button>
        </div>
      </div>

      <TagsSection topicId={id} />

      <div className="grid gap-4 sm:grid-cols-3">
        <ScoreCard title="Own competency" score={topic.metrics.ownScore} health={topic.metrics.ownHealthStatus} />
        <ScoreCard title="Aggregate competency" score={topic.metrics.aggregateScore} health={topic.metrics.aggregateHealthStatus} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Next review</CardTitle>
          </CardHeader>
          <CardContent>
            {schedule?.nextReviewOn ? (
              <>
                <p className="text-lg font-semibold">{new Date(schedule.nextReviewOn).toLocaleDateString()}</p>
                <p className="text-xs text-muted-foreground">Algorithm: {schedule.algorithm}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Not scheduled yet</p>
            )}
            {schedule?.isSuspended ? (
              <Badge variant="secondary" className="mt-1">
                Paused
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Session history</h2>
        <SessionHistoryTable
          sessions={sessionsQuery.data?.sessions ?? []}
          onEdit={setEditSession}
          onDelete={setDeleteSession}
        />
      </div>

      <EditTopicDialog topic={editOpen ? topic : null} onOpenChange={(open) => !open && setEditOpen(false)} />
      <LogSessionDialog
        topic={logOpen ? { id: topic.id, subjectId: topic.subjectId, name: topic.name } : null}
        onOpenChange={(open) => !open && setLogOpen(false)}
      />
      <EditSessionDialog
        session={editSession}
        subjectId={topic.subjectId}
        onOpenChange={(open) => !open && setEditSession(null)}
      />
      <DeleteSessionDialog
        session={deleteSession}
        subjectId={topic.subjectId}
        onOpenChange={(open) => !open && setDeleteSession(null)}
      />
    </div>
  );
}

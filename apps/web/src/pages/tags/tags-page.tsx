import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import {
  statusResponseSchema,
  tagResponseSchema,
  tagsListResponseSchema,
  topicsForTagResponseSchema,
  type TagView,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../admin/users-page';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { EmptyState } from '../../components/empty-state';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Card, CardContent } from '../../components/ui/card';

/** Tag management and cross-subject tag filter (FR-3.9, delivery-plan.md P7 task 9). */
export default function TagsPage(): React.JSX.Element {
  const tagsQuery = useQuery({ queryKey: queryKeys.tags.list(), queryFn: () => apiFetch('/tags', tagsListResponseSchema) });
  const [selected, setSelected] = useState<TagView | null>(null);
  const [newTagName, setNewTagName] = useState('');

  const topicsForTagQuery = useQuery({
    queryKey: selected ? queryKeys.tags.topics(selected.id) : ['tags', 'none'],
    queryFn: () => apiFetch(`/tags/${selected?.id}/topics`, topicsForTagResponseSchema),
    enabled: selected !== null,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => apiFetch('/tags', tagResponseSchema, { method: 'POST', body: { name } }),
    onSuccess: async () => {
      await invalidations.afterTagWrite();
      setNewTagName('');
    },
    onError: (err) => toast({ title: 'Could not create tag', description: describeError(err), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (tagId: string) => apiFetch(`/tags/${tagId}`, statusResponseSchema, { method: 'DELETE' }),
    onSuccess: async () => {
      await invalidations.afterTagWrite();
      setSelected(null);
    },
    onError: (err) => toast({ title: 'Could not delete tag', description: describeError(err), variant: 'destructive' }),
  });

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newTagName.trim();
    if (trimmed.length === 0) return;
    createMutation.mutate(trimmed);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Tags</h1>
        <p className="text-sm text-muted-foreground">Attach tags to topics across any subject, then filter by them here.</p>
      </div>

      <form onSubmit={handleCreate} className="flex max-w-sm gap-2">
        <Input placeholder="New tag name" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} maxLength={60} />
        <Button type="submit" disabled={createMutation.isPending}>
          <Plus /> Add
        </Button>
      </form>

      {tagsQuery.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : tagsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load tags: {describeError(tagsQuery.error)}
        </p>
      ) : tagsQuery.data.tags.length === 0 ? (
        <EmptyState icon={<TagIcon className="size-8" />} title="No tags yet" description="Create a tag to start organising topics across subjects." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {tagsQuery.data.tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => setSelected(selected?.id === tag.id ? null : tag)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                selected?.id === tag.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
              }`}
            >
              {tag.name}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Delete tag ${tag.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate(tag.id);
                }}
              >
                <X className="size-3.5" />
              </span>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Topics tagged &ldquo;{selected.name}&rdquo;</h2>
          {topicsForTagQuery.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : topicsForTagQuery.data && topicsForTagQuery.data.topics.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {topicsForTagQuery.data.topics.map((topic) => (
                <Card key={topic.id}>
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <Link to={`/subjects/${topic.subjectId}/topics/${topic.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                      {topic.name}
                    </Link>
                    <HealthStatusBadge status={(topic.metrics.aggregateHealthStatus ?? 'notStarted') as HealthStatus} />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState title="No topics carry this tag yet" />
          )}
        </div>
      ) : null}
    </div>
  );
}

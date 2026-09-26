import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Rocket, Tag as TagIcon, X } from 'lucide-react';
import {
  createTagRequestSchema,
  renameTagRequestSchema,
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
import { describeError } from '../../lib/api-error';
import { useFormErrors } from '../../lib/form-errors';
import { formatDateOnly } from '../../lib/dates';
import { HealthStatusBadge } from '../../components/health-status-badge';
import { EmptyState } from '../../components/empty-state';
import { FieldError, FormError } from '../../components/field-error';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { LaunchReviewDialog } from '../review/launch-review-dialog';

function RenameTagForm({ tag, onDone }: { tag: TagView; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState(tag.name);
  const form = useFormErrors();
  const renameMutation = useMutation({
    mutationFn: (body: { name: string }) =>
      apiFetch(`/tags/${tag.id}`, tagResponseSchema, { method: 'PATCH', body }),
    onSuccess: async () => {
      await invalidations.afterTagWrite();
      onDone();
    },
    onError: (err) => form.setFromApi(err, 'Could not rename tag'),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const body = { name: name.trim() };
    if (!form.validate(renameTagRequestSchema, body)) return;
    renameMutation.mutate(body);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-wrap items-start gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="rename-tag" className="sr-only">
          New name for {tag.name}
        </Label>
        <Input
          id="rename-tag"
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onDone()}
          className="h-9 w-56"
          {...form.fieldProps('name', 'rename-tag')}
        />
        <FieldError inputId="rename-tag" message={form.errors.name} />
        <FormError message={form.formError} />
      </div>
      <Button type="submit" size="sm" disabled={renameMutation.isPending}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

/** Tag management and cross-subject tag filter (FR-3.9, delivery-plan.md P7 task 9; R4). */
export default function TagsPage(): React.JSX.Element {
  const tagsQuery = useQuery({ queryKey: queryKeys.tags.list(), queryFn: () => apiFetch('/tags', tagsListResponseSchema) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const createForm = useFormErrors();

  // Follow renames: the selected tag is looked up by id in the (refreshed) list.
  const selected = tagsQuery.data?.tags.find((t) => t.id === selectedId) ?? null;
  useEffect(() => setRenaming(false), [selectedId]);

  const topicsForTagQuery = useQuery({
    queryKey: selected ? queryKeys.tags.topics(selected.id) : ['tags', 'none'],
    queryFn: () => apiFetch(`/tags/${selected?.id}/topics`, topicsForTagResponseSchema),
    enabled: selected !== null,
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string }) => apiFetch('/tags', tagResponseSchema, { method: 'POST', body }),
    onSuccess: async () => {
      await invalidations.afterTagWrite();
      setNewTagName('');
    },
    onError: (err) => createForm.setFromApi(err, 'Could not create tag'),
  });

  const deleteMutation = useMutation({
    mutationFn: (tagId: string) => apiFetch(`/tags/${tagId}`, statusResponseSchema, { method: 'DELETE' }),
    onSuccess: async (_data, tagId) => {
      await invalidations.afterTagWrite();
      if (tagId === selectedId) setSelectedId(null);
    },
    onError: (err) => toast({ title: 'Could not delete tag', description: describeError(err), variant: 'destructive' }),
  });

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const body = { name: newTagName.trim() };
    if (!createForm.validate(createTagRequestSchema, body)) return;
    createMutation.mutate(body);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Tags</h1>
        <p className="text-sm text-muted-foreground">Attach tags to topics across any subject, then filter by them here.</p>
      </div>

      <form onSubmit={handleCreate} noValidate className="flex max-w-sm flex-col gap-1">
        <div className="flex gap-2">
          <Label htmlFor="new-tag" className="sr-only">
            New tag name
          </Label>
          <Input
            id="new-tag"
            placeholder="New tag name"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            maxLength={60}
            {...createForm.fieldProps('name', 'new-tag')}
          />
          <Button type="submit" disabled={createMutation.isPending}>
            <Plus /> Add
          </Button>
        </div>
        <FieldError inputId="new-tag" message={createForm.errors.name} />
        <FormError message={createForm.formError} />
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
        <ul className="flex flex-wrap gap-2" aria-label="Tags">
          {tagsQuery.data.tags.map((tag) => {
            const isSelected = selectedId === tag.id;
            return (
              // Two sibling buttons (select, delete) — never one nested in the other, so both are
              // reachable and operable from the keyboard.
              <li
                key={tag.id}
                className={`inline-flex items-center rounded-full border text-sm ${
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(isSelected ? null : tag.id)}
                  className="rounded-l-full py-1 pl-3 pr-1.5"
                >
                  {tag.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete tag ${tag.name}`}
                  onClick={() => deleteMutation.mutate(tag.id)}
                  className="rounded-r-full py-1 pl-1 pr-2.5 opacity-70 hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <section aria-labelledby="tag-topics-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {renaming ? (
              <RenameTagForm tag={selected} onDone={() => setRenaming(false)} />
            ) : (
              <h2 id="tag-topics-heading" className="text-lg font-semibold">
                Topics tagged &ldquo;{selected.name}&rdquo;
              </h2>
            )}
            <div className="flex gap-2">
              {renaming ? null : (
                <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
                  <Pencil /> Rename
                </Button>
              )}
              <Button size="sm" onClick={() => setReviewOpen(true)} disabled={!topicsForTagQuery.data?.topics.length}>
                <Rocket /> Review this tag
              </Button>
            </div>
          </div>
          {topicsForTagQuery.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : topicsForTagQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load tagged topics: {describeError(topicsForTagQuery.error)}
            </p>
          ) : topicsForTagQuery.data.topics.length === 0 ? (
            <EmptyState
              title="No topics carry this tag yet"
              description="Add it from a topic's page to see the topic here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Next review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topicsForTagQuery.data.topics.map((topic) => (
                  <TableRow key={topic.id}>
                    <TableCell>
                      <Link to={`/subjects/${topic.subjectId}/topics/${topic.id}`} className="font-medium hover:underline">
                        {topic.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{topic.subjectName}</TableCell>
                    <TableCell>{topic.score === null ? '—' : Math.round(topic.score)}</TableCell>
                    <TableCell>
                      <HealthStatusBadge status={topic.healthStatus} />
                    </TableCell>
                    <TableCell>{topic.nextReviewOn ? formatDateOnly(topic.nextReviewOn) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <LaunchReviewDialog
            open={reviewOpen}
            onOpenChange={setReviewOpen}
            fixedScope={{ mode: 'tag', tagId: selected.id, label: `topics tagged “${selected.name}”` }}
          />
        </section>
      ) : null}
    </div>
  );
}

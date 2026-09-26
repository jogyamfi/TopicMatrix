import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Archive, BookOpen, Clock, ListTree, Plus } from 'lucide-react';
import { subjectsListResponseSchema, type SubjectListItem } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { describeError } from '../../lib/api-error';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { SubjectDialog } from './subject-dialog';
import { DeleteSubjectDialog } from './delete-subject-dialog';
import { formatDateOnly } from '../../lib/dates';

function formatLastActivity(lastActivityOn: string | null): string {
  if (!lastActivityOn) return 'No sessions yet';
  return `Last studied ${formatDateOnly(lastActivityOn)}`;
}

function SubjectCard({
  subject,
  onEdit,
  onDelete,
}: {
  subject: SubjectListItem;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          {subject.icon ? (
            <span aria-hidden="true" className="text-xl">
              {subject.icon}
            </span>
          ) : (
            <BookOpen aria-hidden="true" className="size-5 text-muted-foreground" />
          )}
          <CardTitle>
            <Link to={`/subjects/${subject.id}`} className="hover:underline">
              {subject.name}
            </Link>
          </CardTitle>
        </div>
        {subject.isArchived ? (
          <Badge variant="secondary">
            <Archive className="size-3" aria-hidden="true" /> Archived
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {subject.colour ? (
          <span
            aria-hidden="true"
            className="h-1 w-10 rounded-full"
            style={{ backgroundColor: subject.colour }}
          />
        ) : null}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Topics</dt>
            <dd className="font-medium">{subject.summary.topicCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Aggregate score</dt>
            <dd className="font-medium">
              {subject.summary.aggregateScore === null ? '—' : Math.round(subject.summary.aggregateScore)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Due today</dt>
            <dd className="font-medium">{subject.summary.dueTodayCount}</dd>
          </div>
        </dl>
        <p className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden="true" />
          {formatLastActivity(subject.summary.lastActivityOn)}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/subjects/${subject.id}`}>
              <ListTree /> Open tree
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Subject list (FR-2.*, delivery-plan.md P7 task 1) — cards with create/edit/delete, each
 * linking through to its topic tree. */
export default function SubjectsPage(): React.JSX.Element {
  const subjectsQuery = useQuery({
    queryKey: queryKeys.subjects.list(),
    queryFn: () => apiFetch('/subjects', subjectsListResponseSchema),
  });

  // `?new=1` (the dashboard's getting-started link) opens the create dialog straight away.
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpenState] = useState(() => searchParams.get('new') === '1');
  const setCreateOpen = (open: boolean) => {
    setCreateOpenState(open);
    if (!open && searchParams.has('new')) setSearchParams({}, { replace: true });
  };
  const [editTarget, setEditTarget] = useState<SubjectListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubjectListItem | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Subjects</h1>
          <p className="text-sm text-muted-foreground">Break each subject down into a tree of topics.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus /> New subject
        </Button>
      </div>

      {subjectsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : subjectsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load subjects: {describeError(subjectsQuery.error)}
        </p>
      ) : subjectsQuery.data.subjects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-8" />}
          title="No subjects yet"
          description="Create your first subject to start building a topic tree."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New subject
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjectsQuery.data.subjects.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              onEdit={() => setEditTarget(subject)}
              onDelete={() => setDeleteTarget(subject)}
            />
          ))}
        </div>
      )}

      <SubjectDialog subject={null} open={createOpen} onOpenChange={setCreateOpen} />
      <SubjectDialog
        subject={editTarget}
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
      <DeleteSubjectDialog subject={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} />
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { StudySessionView } from '@topicmatrix/shared';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { EmptyState } from '../../components/empty-state';
import { formatDateOnly } from '../../lib/dates';

type SortKey = 'studiedOn' | 'questionsAttempted' | 'accuracy' | 'confidence';

const PAGE_SIZE = 10;
const GRADE_LABELS: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

function SortButton({
  label,
  sortKey,
  active,
  direction,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: 'asc' | 'desc';
  onClick: (key: SortKey) => void;
}): React.JSX.Element {
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className="flex items-center gap-1 font-medium hover:text-foreground"
    >
      {label}
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/** Session history table (FR-4.6, P7 task 7) — sortable and paginated. */
export function SessionHistoryTable({
  sessions,
  onEdit,
  onDelete,
}: {
  sessions: readonly StudySessionView[];
  onEdit: (session: StudySessionView) => void;
  onDelete: (session: StudySessionView) => void;
}): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('studiedOn');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDirection('desc');
    }
    setPage(0);
  };

  const sorted = useMemo(() => {
    const copy = [...sessions];
    copy.sort((a, b) => {
      const va = sortKey === 'studiedOn' ? new Date(a.studiedOn).getTime() : a[sortKey];
      const vb = sortKey === 'studiedOn' ? new Date(b.studiedOn).getTime() : b[sortKey];
      return direction === 'asc' ? va - vb : vb - va;
    });
    return copy;
  }, [sessions, sortKey, direction]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (sessions.length === 0) {
    return <EmptyState title="No sessions logged yet" description="Log your first session to start tracking progress." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <SortButton label="Date" sortKey="studiedOn" active={sortKey === 'studiedOn'} direction={direction} onClick={toggleSort} />
            </TableHead>
            <TableHead>Source</TableHead>
            <TableHead>
              <SortButton
                label="Questions"
                sortKey="questionsAttempted"
                active={sortKey === 'questionsAttempted'}
                direction={direction}
                onClick={toggleSort}
              />
            </TableHead>
            <TableHead>
              <SortButton label="Accuracy" sortKey="accuracy" active={sortKey === 'accuracy'} direction={direction} onClick={toggleSort} />
            </TableHead>
            <TableHead>
              <SortButton
                label="Confidence"
                sortKey="confidence"
                active={sortKey === 'confidence'}
                direction={direction}
                onClick={toggleSort}
              />
            </TableHead>
            <TableHead>Grade</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map((session) => (
            <TableRow key={session.id}>
              <TableCell>{formatDateOnly(session.studiedOn)}</TableCell>
              <TableCell className="text-muted-foreground">{session.sourceLabel ?? '—'}</TableCell>
              <TableCell>
                {session.questionsCorrect}/{session.questionsAttempted}
              </TableCell>
              <TableCell>{Math.round(session.accuracy * 100)}%</TableCell>
              <TableCell>{session.confidence}</TableCell>
              <TableCell>{session.gradeUsed !== null ? GRADE_LABELS[session.gradeUsed] : '—'}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(session)}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onDelete(session)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

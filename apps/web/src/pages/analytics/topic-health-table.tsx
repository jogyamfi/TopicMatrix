import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { TopicHealthResponse } from '@topicmatrix/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { EmptyState } from '../../components/empty-state';

type Row = TopicHealthResponse['topics'][number];
type SortKey = 'name' | 'subjectName' | 'score' | 'healthStatus' | 'lastReviewedOn' | 'nextReviewOn' | 'accuracyPct' | 'confidencePct';

function sortValue(row: Row, key: SortKey): string | number {
  const value = row[key];
  if (value === null) return key === 'score' || key === 'accuracyPct' || key === 'confidencePct' ? -1 : '';
  return value;
}

function ReviewTrendIcon({ trend }: { trend: Row['reviewTrend'] }): React.JSX.Element {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-1 text-green-700">
        <TrendingUp className="size-3.5" aria-hidden="true" /> Up
      </span>
    );
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-1 text-red-700">
        <TrendingDown className="size-3.5" aria-hidden="true" /> Down
      </span>
    );
  }
  if (trend === 'flat') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="size-3.5" aria-hidden="true" /> Flat
      </span>
    );
  }
  return <span className="text-muted-foreground">\u2014</span>;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Topic' },
  { key: 'subjectName', label: 'Subject' },
  { key: 'score', label: 'Competency' },
  { key: 'healthStatus', label: 'Health' },
  { key: 'lastReviewedOn', label: 'Last reviewed' },
  { key: 'nextReviewOn', label: 'Next review' },
  { key: 'accuracyPct', label: 'Accuracy %' },
  { key: 'confidencePct', label: 'Confidence %' },
];

/** FR-7.6: every topic, sortable and filterable on every column. */
export function TopicHealthTable({ topics }: { topics: Row[] }): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [nameFilter, setNameFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | HealthStatus>('all');

  const filtered = useMemo(() => {
    return topics.filter((row) => {
      const matchesName =
        nameFilter.trim() === '' ||
        row.name.toLowerCase().includes(nameFilter.toLowerCase()) ||
        row.subjectName.toLowerCase().includes(nameFilter.toLowerCase());
      const matchesHealth = healthFilter === 'all' || row.healthStatus === healthFilter;
      return matchesName && matchesHealth;
    });
  }, [topics, nameFilter, healthFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by topic or subject name"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="max-w-xs"
          aria-label="Filter by topic or subject name"
        />
        <Select value={healthFilter} onValueChange={(v) => setHealthFilter(v as typeof healthFilter)}>
          <SelectTrigger className="w-44" aria-label="Filter by health status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All health statuses</SelectItem>
            <SelectItem value="strong">Strong</SelectItem>
            <SelectItem value="needsReview">Needs review</SelectItem>
            <SelectItem value="atRisk">At risk</SelectItem>
            <SelectItem value="notStarted">Not started</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No topics match" description="Try clearing the filters." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => (
                <TableHead key={col.key} aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="size-3.5" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />
                    )}
                  </button>
                </TableHead>
              ))}
              <TableHead>Trend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.topicId}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.subjectName}</TableCell>
                <TableCell>{row.score === null ? '\u2014' : Math.round(row.score)}</TableCell>
                <TableCell>
                  <HealthStatusBadge status={row.healthStatus as HealthStatus} />
                </TableCell>
                <TableCell>{row.lastReviewedOn ? row.lastReviewedOn.slice(0, 10) : '\u2014'}</TableCell>
                <TableCell>{row.nextReviewOn ? row.nextReviewOn.slice(0, 10) : '\u2014'}</TableCell>
                <TableCell>{row.accuracyPct === null ? '\u2014' : Math.round(row.accuracyPct)}</TableCell>
                <TableCell>{row.confidencePct === null ? '\u2014' : Math.round(row.confidencePct)}</TableCell>
                <TableCell>
                  <ReviewTrendIcon trend={row.reviewTrend} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

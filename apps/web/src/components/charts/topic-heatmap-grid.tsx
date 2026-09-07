import { Circle, Clock } from 'lucide-react';
import type { HeatmapTopic } from '@topicmatrix/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { cn } from '../../lib/utils';
import { ChartWithDataTable } from './chart-with-data-table';

function scoreColourClass(score: number): string {
  if (score >= 75) return 'bg-green-100 text-green-900 border-green-300';
  if (score >= 50) return 'bg-yellow-100 text-yellow-900 border-yellow-300';
  return 'bg-red-100 text-red-900 border-red-300';
}

function statusLabel(topic: HeatmapTopic): string {
  if (topic.status === 'neverStarted') return 'Not started';
  if (topic.status === 'neglected') return `Neglected (score ${Math.round(topic.score ?? 0)})`;
  return `Score ${Math.round(topic.score ?? 0)}`;
}

/**
 * FR-7.5: the topic tree as a colour-coded grid. *Neglected* and *never started* topics never
 * rely on colour alone (NF-4) \u2014 each gets its own icon and text label distinct from a plain
 * score cell, on top of whatever colour class the cell also has.
 */
export function TopicHeatmapGrid({ topics }: { topics: HeatmapTopic[] }): React.JSX.Element {
  return (
    <ChartWithDataTable
      title="Topic heatmap: competency score by topic"
      chart={
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {topics.map((topic) => (
            <li
              key={topic.topicId}
              title={statusLabel(topic)}
              className={cn(
                'flex flex-col gap-1 rounded-md border p-3 text-sm',
                topic.status === 'neverStarted'
                  ? 'border-dashed bg-muted text-muted-foreground'
                  : topic.status === 'neglected'
                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                    : scoreColourClass(topic.score ?? 0),
              )}
            >
              <span className="truncate font-medium">{topic.name}</span>
              <span className="flex items-center gap-1 text-xs">
                {topic.status === 'neverStarted' ? (
                  <>
                    <Circle className="size-3.5" aria-hidden="true" /> Not started
                  </>
                ) : topic.status === 'neglected' ? (
                  <>
                    <Clock className="size-3.5" aria-hidden="true" /> Neglected
                  </>
                ) : (
                  <>{Math.round(topic.score ?? 0)}</>
                )}
              </span>
            </li>
          ))}
        </ul>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Topic</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topics.map((topic) => (
              <TableRow key={topic.topicId}>
                <TableCell>{topic.name}</TableCell>
                <TableCell>{topic.score === null ? '\u2014' : Math.round(topic.score)}</TableCell>
                <TableCell>{statusLabel(topic)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}

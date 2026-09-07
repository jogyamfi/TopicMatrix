import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RetentionResponse } from '@topicmatrix/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ChartWithDataTable } from './chart-with-data-table';

interface RetentionChartPoint {
  date: string;
  projection?: number;
  event?: number;
}

function mergeSeries(data: RetentionResponse): RetentionChartPoint[] {
  const byDate = new Map<string, RetentionChartPoint>();
  for (const point of data.projection) {
    byDate.set(point.date, { date: point.date, projection: point.score });
  }
  for (const event of data.events) {
    const existing = byDate.get(event.date);
    byDate.set(event.date, { ...existing, date: event.date, event: event.score });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * FR-7.7: competency score over time, with review events marked (solid dots) and the modelled
 * decay between reviews shown as a dashed projection line \u2014 making forgetting and post-review
 * recovery visible.
 */
export function RetentionCurveChart({ data }: { data: RetentionResponse }): React.JSX.Element {
  const points = mergeSeries(data);

  return (
    <ChartWithDataTable
      title="Knowledge retention curve"
      chart={
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={points} margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="projection"
                name="Modelled decay"
                stroke="#6366f1"
                strokeDasharray="5 5"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Scatter dataKey="event" name="Review event" fill="#16a34a" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Review event score</TableHead>
              <TableHead>Modelled decay score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.date}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{p.event === undefined ? '\u2014' : Math.round(p.event)}</TableCell>
                <TableCell>{p.projection === undefined ? '\u2014' : Math.round(p.projection)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MasteryTopic } from '@topicmatrix/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ChartWithDataTable } from './chart-with-data-table';

const NO_SCORE_FILL = '#d1d5db'; // gray-300, paired with the "—" label in the table (never colour alone, NF-4)

function barColour(score: number | null): string {
  if (score === null) return NO_SCORE_FILL;
  if (score >= 75) return '#16a34a'; // green-600
  if (score >= 50) return '#ca8a04'; // yellow-600
  return '#dc2626'; // red-600
}

/** FR-7.4: competency score per topic in a subject, as a horizontal bar chart. */
export function MasteryBarChart({ topics }: { topics: MasteryTopic[] }): React.JSX.Element {
  const data = topics.map((t) => ({ ...t, displayScore: t.score ?? 0 }));

  return (
    <ChartWithDataTable
      title="Mastery chart: competency score per topic"
      chart={
        <div style={{ width: '100%', height: Math.max(200, data.length * 36) }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ left: 24, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} />
              <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(_value, _name, item) => {
                  const score = (item.payload as { score: number | null }).score;
                  return [score === null ? 'Not started' : Math.round(score), 'Score'];
                }}
              />
              <Bar dataKey="displayScore" isAnimationActive={false}>
                {data.map((t) => (
                  <Cell key={t.topicId} fill={barColour(t.score)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Topic</TableHead>
              <TableHead>Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topics.map((t) => (
              <TableRow key={t.topicId}>
                <TableCell>{t.name}</TableCell>
                <TableCell>{t.score === null ? '\u2014' : Math.round(t.score)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}

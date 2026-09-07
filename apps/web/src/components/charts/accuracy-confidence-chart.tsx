import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AccuracyConfidenceResponse } from '@topicmatrix/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ChartWithDataTable } from './chart-with-data-table';

/** FR-7.8: per-session accuracy and confidence on a shared 0..100% time axis, to expose calibration gaps. */
export function AccuracyConfidenceChart({
  data,
}: {
  data: AccuracyConfidenceResponse;
}): React.JSX.Element {
  const points = data.points.map((p, i) => ({
    key: `${p.date}-${i}`,
    date: p.date,
    accuracyPct: p.accuracy * 100,
    confidencePct: p.confidenceNormalised * 100,
  }));

  return (
    <ChartWithDataTable
      title="Accuracy vs confidence over time"
      chart={
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={points} margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="accuracyPct"
                name="Accuracy %"
                stroke="#2563eb"
                dot={{ r: 2 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="confidencePct"
                name="Confidence %"
                stroke="#d97706"
                dot={{ r: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Accuracy %</TableHead>
              <TableHead>Confidence %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.key}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{Math.round(p.accuracyPct)}</TableCell>
                <TableCell>{Math.round(p.confidencePct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}

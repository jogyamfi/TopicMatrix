import type { ActivityCalendarDay } from '@topicmatrix/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { cn } from '../lib/utils';

function intensityClass(count: number): string {
  if (count === 0) return 'bg-muted';
  if (count === 1) return 'bg-green-200';
  if (count <= 3) return 'bg-green-400';
  return 'bg-green-600';
}

/** FR-7.3: a 12-month activity calendar heatmap, grouped into week columns like a contribution graph. */
export function ActivityCalendar({ days }: { days: ActivityCalendarDay[] }): React.JSX.Element {
  const first = days[0];
  // Pad the front so the first column starts on the same weekday as `first`, for a clean grid.
  const leadingBlanks = first ? new Date(`${first.date}T00:00:00.000Z`).getUTCDay() : 0;
  const cells: (ActivityCalendarDay | null)[] = [...Array(leadingBlanks).fill(null), ...days];
  const weeks: (ActivityCalendarDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={`Activity calendar for the last ${days.length} days`}>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1">
              {week.map((day, dayIndex) =>
                day ? (
                  <div
                    key={day.date}
                    title={`${day.date}: ${day.sessionCount} session${day.sessionCount === 1 ? '' : 's'}`}
                    className={cn('size-3 rounded-sm', intensityClass(day.sessionCount))}
                  />
                ) : (
                  <div key={`blank-${dayIndex}`} className="size-3" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">View data as a table</summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Sessions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days
                .filter((d) => d.sessionCount > 0)
                .map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{d.date}</TableCell>
                    <TableCell>{d.sessionCount}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  );
}

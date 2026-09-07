import { useId, type ReactNode } from 'react';

/**
 * Wraps a chart with an accessible text-alternative data table behind a native `<details>`
 * disclosure (NF-4, delivery-plan.md P9 task 8) \u2014 every chart gets one of these rather than
 * relying on the visual chart alone to convey its data.
 */
export function ChartWithDataTable({
  title,
  chart,
  table,
}: {
  title: string;
  chart: ReactNode;
  table: ReactNode;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-labelledby={id}>
        <h3 id={id} className="sr-only">
          {title}
        </h3>
        {chart}
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">View data as a table</summary>
        <div className="mt-3">{table}</div>
      </details>
    </div>
  );
}

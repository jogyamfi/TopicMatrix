// Shared date-range preset logic for analytics screens (FR-7.9): 30 / 90 / 365 days / all time,
// applied consistently across every P9 chart that accepts a range.
export type DateRangePreset = '30' | '90' | '365' | 'all';

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 365 days' },
  { value: 'all', label: 'All time' },
];

/** `from`/`to` as `YYYY-MM-DD` query values; `from` is omitted for `'all'`. */
export function resolveDateRange(preset: DateRangePreset): { from?: string; to?: string } {
  const to = new Date().toISOString().slice(0, 10);
  if (preset === 'all') {
    return { to };
  }
  const days = Number(preset);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

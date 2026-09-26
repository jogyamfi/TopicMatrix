import { isoDateMinusDays } from './dates';

// Shared date-range preset logic for analytics screens (FR-7.9): 30 / 90 / 365 days / all time,
// applied consistently across every P9 chart that accepts a range.
export type DateRangePreset = '30' | '90' | '365' | 'all';

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 365 days' },
  { value: 'all', label: 'All time' },
];

/**
 * `from`/`to` as `YYYY-MM-DD` query values; `from` is omitted for `'all'`. `today` is the user's
 * current day (`useUserToday`) — anchoring on the UTC date instead would drop today's sessions
 * for anyone east of UTC until UTC midnight.
 */
export function resolveDateRange(preset: DateRangePreset, today: string): { from?: string; to?: string } {
  if (preset === 'all') {
    return { to: today };
  }
  return { from: isoDateMinusDays(today, Number(preset)), to: today };
}

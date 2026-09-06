/**
 * Single shared helper for case-insensitive uniqueness (SRS §6.3): normalises a display value
 * into the form stored in a companion `*Normalised` column and compared against for uniqueness.
 * Every call site must go through this — normalisation never happens ad hoc at the repository.
 */
export function normaliseKey(value: string): string {
  return value.trim().toLowerCase();
}

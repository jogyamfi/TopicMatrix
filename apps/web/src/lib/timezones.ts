// IANA timezone helpers for the settings picker and the "your device is in another timezone"
// banner (R3 U-7).

const FALLBACK_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
];

/** The device's timezone, or null if the browser won't say. */
export function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Every timezone the browser knows (`Intl.supportedValuesOf`), plus UTC, sorted. */
export function allTimezones(): string[] {
  const intl = Intl as { supportedValuesOf?: (key: 'timeZone') => string[] };
  try {
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) {
      return [...new Set(['UTC', ...zones])].sort();
    }
  } catch {
    // Older engines: fall through to the short list.
  }
  return FALLBACK_TIMEZONES;
}

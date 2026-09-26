/**
 * Picks the real client IP behind `trustedHops` reverse proxies (SEC-8 rate limiting keys on it).
 *
 * Each trusted proxy APPENDS the address it received the request from to `X-Forwarded-For`
 * (nginx's `$proxy_add_x_forwarded_for`), so with N trusted proxies the client is the N-th entry
 * counted from the right. Anything further left was supplied by the client itself and is never
 * trusted — taking the left-most entry would let an attacker pick their own rate-limit bucket.
 * Falls back to the socket address when proxies aren't trusted or the header is missing/short.
 */
export function resolveClientIp(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  trustedHops: number,
): string {
  const fallback = socketAddress ?? 'unknown';
  if (trustedHops <= 0 || !forwardedFor) {
    return fallback;
  }
  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries[entries.length - trustedHops] ?? fallback;
}

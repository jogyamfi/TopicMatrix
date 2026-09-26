import { describe, expect, it } from 'vitest';
import { resolveClientIp } from './client-ip.js';

describe('resolveClientIp', () => {
  it('uses the socket address when no proxy is trusted, ignoring a client-supplied header', () => {
    expect(resolveClientIp('203.0.113.9', '1.2.3.4', 0)).toBe('203.0.113.9');
  });

  it('behind one trusted proxy, uses the entry that proxy appended (the right-most)', () => {
    // nginx on the docker network: the socket address is nginx's own container IP.
    expect(resolveClientIp('172.18.0.5', '198.51.100.7', 1)).toBe('198.51.100.7');
  });

  it('never trusts entries a client prepended itself', () => {
    expect(resolveClientIp('172.18.0.5', 'spoofed-1, spoofed-2, 198.51.100.7', 1)).toBe('198.51.100.7');
  });

  it('counts back one entry per trusted hop', () => {
    expect(resolveClientIp('10.0.0.2', 'spoofed, 198.51.100.7, 10.0.0.1', 2)).toBe('198.51.100.7');
  });

  it('falls back to the socket address when the header is missing or shorter than the hop count', () => {
    expect(resolveClientIp('172.18.0.5', undefined, 1)).toBe('172.18.0.5');
    expect(resolveClientIp('10.0.0.2', '198.51.100.7', 2)).toBe('10.0.0.2');
    expect(resolveClientIp(undefined, undefined, 1)).toBe('unknown');
  });
});

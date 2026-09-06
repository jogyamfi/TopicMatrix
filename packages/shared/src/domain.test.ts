import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANUAL_INTERVALS,
  parseManualIntervals,
  stringifyManualIntervals,
} from './domain.js';

describe('manual intervals JSON round-trip', () => {
  it('stringifies and parses back to the same array', () => {
    const json = stringifyManualIntervals([...DEFAULT_MANUAL_INTERVALS]);
    expect(parseManualIntervals(json)).toEqual([...DEFAULT_MANUAL_INTERVALS]);
  });

  it('rejects a non-positive interval', () => {
    expect(() => stringifyManualIntervals([1, 0, 7])).toThrow();
  });

  it('rejects malformed stored JSON', () => {
    expect(() => parseManualIntervals('{"not":"an array"}')).toThrow();
  });
});

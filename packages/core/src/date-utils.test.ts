import { describe, expect, it } from 'vitest';
import { addUtcDays, daysBetween } from './date-utils.js';

describe('daysBetween', () => {
  it('is positive when `to` is later than `from`', () => {
    expect(daysBetween(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-11T00:00:00Z'))).toBe(10);
  });
  it('is negative when `to` is earlier than `from`', () => {
    expect(daysBetween(new Date('2026-01-11T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(-10);
  });
  it('is zero for the same instant', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(daysBetween(d, d)).toBe(0);
  });
});

describe('addUtcDays', () => {
  it('adds whole days as UTC instants', () => {
    const result = addUtcDays(new Date('2026-01-01T00:00:00Z'), 5);
    expect(result.toISOString()).toBe('2026-01-06T00:00:00.000Z');
  });
  it('supports negative days', () => {
    const result = addUtcDays(new Date('2026-01-06T00:00:00Z'), -5);
    expect(result.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

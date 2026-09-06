import { describe, expect, it } from 'vitest';
import { normaliseKey } from './normalize.js';

describe('normaliseKey', () => {
  it('lower-cases', () => {
    expect(normaliseKey('Algebra')).toBe('algebra');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseKey('  Algebra  ')).toBe('algebra');
  });

  it('is idempotent', () => {
    const once = normaliseKey('Mixed CASE Name');
    expect(normaliseKey(once)).toBe(once);
  });
});

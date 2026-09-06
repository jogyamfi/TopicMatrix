import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, validatePassword } from './password-policy.js';

describe('validatePassword', () => {
  it('rejects passwords shorter than the minimum length', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/);
  });

  it('accepts a password at exactly the minimum length that is not common', () => {
    expect(validatePassword('correct-horse')).toBeNull();
  });

  it('rejects a password on the common-password deny list, case-insensitively', () => {
    expect(validatePassword('password1234')).toMatch(/too common/);
    expect(validatePassword('PASSWORD1234')).toMatch(/too common/);
  });
});

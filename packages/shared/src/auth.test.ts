import { describe, expect, it } from 'vitest';
import {
  adminDeleteUserRequestSchema,
  adminUpdateUserRequestSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
} from './auth.js';

describe('loginRequestSchema', () => {
  it('accepts a valid email/password pair', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(loginRequestSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(
      false,
    );
  });
});

describe('changePasswordRequestSchema', () => {
  it('rejects a new password that fails the password policy', () => {
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: 'whatever',
      newPassword: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a compliant new password', () => {
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: 'whatever',
      newPassword: 'correct-horse-battery',
    });
    expect(result.success).toBe(true);
  });
});

describe('adminUpdateUserRequestSchema', () => {
  it('rejects an empty patch', () => {
    expect(adminUpdateUserRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a partial patch', () => {
    expect(adminUpdateUserRequestSchema.safeParse({ isActive: false }).success).toBe(true);
  });
});

describe('adminDeleteUserRequestSchema', () => {
  it('rejects confirm: false', () => {
    expect(adminDeleteUserRequestSchema.safeParse({ confirm: false }).success).toBe(false);
  });

  it('accepts confirm: true', () => {
    expect(adminDeleteUserRequestSchema.safeParse({ confirm: true }).success).toBe(true);
  });
});

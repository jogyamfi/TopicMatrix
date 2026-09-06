import { z } from 'zod';
import { validatePassword } from './password-policy.js';

// Single source of truth for auth/admin-user request shapes (P2) — types are inferred, never
// hand-written twice.

const passwordSchema = z.string().superRefine((value, ctx) => {
  const message = validatePassword(value);
  if (message) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const adminCreateUserRequestSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(120),
});
export type AdminCreateUserRequest = z.infer<typeof adminCreateUserRequestSchema>;

export const adminUpdateUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.isActive !== undefined, {
    message: 'At least one field must be provided',
  });
export type AdminUpdateUserRequest = z.infer<typeof adminUpdateUserRequestSchema>;

// Explicit typed confirmation, not just any truthy value (FR-1.8) — the UI makes the user type
// the account's name/email; the API only requires the boolean flag be explicitly true.
export const adminDeleteUserRequestSchema = z.object({
  confirm: z.literal(true),
});
export type AdminDeleteUserRequest = z.infer<typeof adminDeleteUserRequestSchema>;

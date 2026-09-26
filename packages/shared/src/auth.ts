import { z } from 'zod';
import { validatePassword } from './password-policy.js';
import { roleSchema } from './domain.js';

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
    role: roleSchema.optional(),
  })
  .refine((v) => v.displayName !== undefined || v.isActive !== undefined || v.role !== undefined, {
    message: 'At least one field must be provided',
  });
export type AdminUpdateUserRequest = z.infer<typeof adminUpdateUserRequestSchema>;

// Explicit typed confirmation, not just any truthy value (FR-1.8) — the UI makes the user type
// the account's name/email; the API only requires the boolean flag be explicitly true.
export const adminDeleteUserRequestSchema = z.object({
  confirm: z.literal(true),
});
export type AdminDeleteUserRequest = z.infer<typeof adminDeleteUserRequestSchema>;

// Response shapes (P6) — the web app's typed API client parses every response through these
// at the boundary (delivery-plan.md P6 task 3): a schema mismatch is a loud error, never a
// silent `undefined`.
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  mustChangePassword: z.boolean(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: publicUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const statusResponseSchema = z.object({ status: z.string() });
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const adminUserViewSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
});
export type AdminUserView = z.infer<typeof adminUserViewSchema>;

export const adminUsersListResponseSchema = z.object({
  users: z.array(adminUserViewSchema),
});
export type AdminUsersListResponse = z.infer<typeof adminUsersListResponseSchema>;

export const adminCreateUserResponseSchema = z.object({
  user: adminUserViewSchema,
  temporaryPassword: z.string(),
});
export type AdminCreateUserResponse = z.infer<typeof adminCreateUserResponseSchema>;

export const adminUpdateUserResponseSchema = z.object({ user: adminUserViewSchema });

// POST /admin/users/:id/reset-password (R4) — a fresh temporary password, shown once.
export const adminResetPasswordResponseSchema = z.object({ temporaryPassword: z.string() });
export type AdminResetPasswordResponse = z.infer<typeof adminResetPasswordResponseSchema>;
export type AdminUpdateUserResponse = z.infer<typeof adminUpdateUserResponseSchema>;

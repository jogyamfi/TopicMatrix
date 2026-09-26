import type { Hono } from 'hono';
import {
  AppError,
  adminCreateUserRequestSchema,
  adminDeleteUserRequestSchema,
  adminUpdateUserRequestSchema,
  normaliseKey,
} from '@topicmatrix/shared';
import { createUserWithDefaultSettings, deleteUserAccount, type User } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { randomOpaqueToken } from '../auth/crypto-utils.js';
import { parseJsonBody } from '../validation.js';
import { recordAudit } from '../audit.js';
import { getAuthUser, requireAdmin, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function toAdminUserView(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

/** exactOptionalPropertyTypes rejects `{ displayName: undefined }` — the Zod schema's optional
 * fields are typed `T | undefined`, not just optional, so a plain `Partial<T>` isn't enough:
 * this also strips `undefined` from each value's type, not just makes the key optional. */
function withoutUndefined<T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const result: { [K in keyof T]?: Exclude<T[K], undefined> } = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    if (value !== undefined) {
      result[key] = value as Exclude<T[typeof key], undefined>;
    }
  }
  return result;
}

/**
 * Admin user management (FR-1.8). An admin can never deactivate or delete their OWN account:
 * the acting admin is by definition active, so this alone guarantees at least one active admin
 * always remains to manage accounts. (Roles can't be changed through this API; if that's ever
 * added, it also needs a "not the last active admin" check.)
 *
 * Deliberately the only surface under /admin — this route file never touches subjects/topics/
 * sessions and never will (SRS §16 Q7: admins cannot read learner study data); see
 * index.test.ts's assertion that no such route is registered.
 */
export function registerAdminRoutes(app: Hono<AppEnv>): void {
  app.use('/admin/*', requireAuth, requirePasswordChanged, requireAdmin);

  app.get('/admin/users', async (c) => {
    const deps = c.get('deps');
    const users = await deps.db.users.list();
    return c.json({ users: users.map(toAdminUserView) });
  });

  app.post('/admin/users', async (c) => {
    const deps = c.get('deps');
    const actor = getAuthUser(c);
    const body = await parseJsonBody(c, adminCreateUserRequestSchema);
    const emailNormalised = normaliseKey(body.email);

    const existing = await deps.db.users.findByEmailNormalised(emailNormalised);
    if (existing) {
      throw new AppError('CONFLICT', 'A user with this email already exists');
    }

    // Shown once in this response only — never logged, never stored in plaintext (FR-1.8/P6).
    const temporaryPassword = randomOpaqueToken(9);
    const passwordHash = await deps.passwordService.hash(temporaryPassword);

    const user = await createUserWithDefaultSettings(
      deps.db,
      {
        email: body.email,
        emailNormalised,
        passwordHash,
        displayName: body.displayName,
        mustChangePassword: true,
      },
      { timezone: deps.config.defaultTimezone },
    );

    await recordAudit(deps, {
      actorId: actor.id,
      action: 'admin.user.create',
      targetId: user.id,
    });

    return c.json({ user: toAdminUserView(user), temporaryPassword }, 201);
  });

  app.patch('/admin/users/:id', async (c) => {
    const deps = c.get('deps');
    const actor = getAuthUser(c);
    const targetId = c.req.param('id');
    const body = await parseJsonBody(c, adminUpdateUserRequestSchema);

    const target = await deps.db.users.findById(targetId);
    if (!target) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
    if (body.isActive === false && targetId === actor.id) {
      throw new AppError('FORBIDDEN', 'You cannot deactivate your own account');
    }

    const updated = await deps.db.users.update(targetId, withoutUndefined(body));
    if (body.isActive === false) {
      await deps.db.refreshTokens.revokeAllForUser(targetId);
    }

    await recordAudit(deps, {
      actorId: actor.id,
      action: 'admin.user.update',
      targetId,
      metadata: body,
    });
    return c.json({ user: toAdminUserView(updated) });
  });

  app.delete('/admin/users/:id', async (c) => {
    const deps = c.get('deps');
    const actor = getAuthUser(c);
    const targetId = c.req.param('id');
    await parseJsonBody(c, adminDeleteUserRequestSchema);

    const target = await deps.db.users.findById(targetId);
    if (!target) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
    if (targetId === actor.id) {
      throw new AppError('FORBIDDEN', 'You cannot delete your own account');
    }

    await deleteUserAccount(deps.db, targetId);
    await recordAudit(deps, { actorId: actor.id, action: 'admin.user.delete', targetId });
    return c.json({ status: 'ok' });
  });
}

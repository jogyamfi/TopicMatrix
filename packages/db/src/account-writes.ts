import type { Db } from './db.js';
import { createUserRepository, type CreateUserInput } from './repositories/user.js';
import { createUserSettingsRepository } from './repositories/user-settings.js';
import {
  createRefreshTokenRepository,
  type CreateRefreshTokenInput,
} from './repositories/refresh-token.js';
import type { RefreshToken, User } from './types.js';

// Multi-step account writes that must commit together (one UnitOfWork each) — otherwise a crash
// between steps leaves a user without the settings row every other query requires, or a
// revoked refresh token with no successor (a forced logout).

/** A new user plus their default settings row (§6.1: every user has exactly one). */
export function createUserWithDefaultSettings(
  db: Db,
  input: CreateUserInput,
  settings?: { timezone?: string },
): Promise<User> {
  return db.unitOfWork.run(async (tx) => {
    const user = await createUserRepository(tx).create(input);
    await createUserSettingsRepository(tx).createDefault(user.id, settings);
    return user;
  });
}

/** Revokes `oldTokenId` (as of `now`) as replaced by a new token with `next`'s hash/expiry, atomically. */
export function rotateRefreshToken(
  db: Db,
  userId: string,
  oldTokenId: string,
  next: CreateRefreshTokenInput,
  now: Date,
): Promise<RefreshToken> {
  return db.unitOfWork.run((tx) => createRefreshTokenRepository(tx).rotate(userId, oldTokenId, next, now));
}

/**
 * A user's own password change (FR-1.6 and self-service, R4): sets the new hash, clears
 * `mustChangePassword`, ends every existing session and starts one fresh session (the
 * caller's), atomically — so the browser that changed the password stays signed in.
 */
export function changePasswordAndRestartSessions(
  db: Db,
  userId: string,
  passwordHash: string,
  freshSession: CreateRefreshTokenInput,
): Promise<User> {
  return db.unitOfWork.run(async (tx) => {
    const user = await createUserRepository(tx).update(userId, { passwordHash, mustChangePassword: false });
    const tokens = createRefreshTokenRepository(tx);
    await tokens.revokeAllForUser(userId);
    await tokens.create(userId, freshSession);
    return user;
  });
}

/**
 * Admin password reset (R4): a temporary password the user must change at next login, and every
 * existing session ended, atomically.
 */
export function resetToTemporaryPassword(db: Db, userId: string, passwordHash: string): Promise<User> {
  return db.unitOfWork.run(async (tx) => {
    const user = await createUserRepository(tx).update(userId, { passwordHash, mustChangePassword: true });
    await createRefreshTokenRepository(tx).revokeAllForUser(userId);
    return user;
  });
}

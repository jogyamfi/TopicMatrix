import { AppError } from '@topicmatrix/shared';
import type { PrismaClientOrTx, RefreshToken } from '../types.js';

export interface CreateRefreshTokenInput {
  tokenHash: string;
  expiresAt: Date;
}

/** Revoked tokens are kept this long so reuse of a rotated-away token can still be recognised. */
export const REVOKED_TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface RefreshTokenRepository {
  create(userId: string, input: CreateRefreshTokenInput): Promise<RefreshToken>;
  /** Global lookup by hash — the caller doesn't know which user a presented token belongs to yet. */
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;
  /** Revokes a token outright (logout) — NOT a rotation, so `replacedByTokenId` stays null. */
  revoke(userId: string, id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  /**
   * Revokes `id` (as of `now` — the same clock the grace-window check reads) as replaced by a
   * freshly created token, in the caller's transaction (see `rotateRefreshToken` in
   * account-writes.ts for the atomic wrapper).
   */
  rotate(userId: string, id: string, next: CreateRefreshTokenInput, now: Date): Promise<RefreshToken>;
  /**
   * Deletes the user's expired tokens and tokens revoked more than `REVOKED_TOKEN_RETENTION_MS`
   * ago. Run opportunistically on login — cheap, runtime-agnostic, no scheduled job needed.
   */
  purgeStaleForUser(userId: string, now: Date): Promise<number>;
}

export function createRefreshTokenRepository(client: PrismaClientOrTx): RefreshTokenRepository {
  async function findOwned(userId: string, id: string): Promise<RefreshToken> {
    const token = await client.refreshToken.findFirst({ where: { id, userId } });
    if (!token) {
      throw new AppError('NOT_FOUND', 'Refresh token not found');
    }
    return token;
  }

  return {
    create: (userId, input) => client.refreshToken.create({ data: { userId, ...input } }),
    findByTokenHash: (tokenHash) => client.refreshToken.findUnique({ where: { tokenHash } }),
    revoke: async (userId, id) => {
      await findOwned(userId, id);
      await client.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
    },
    revokeAllForUser: async (userId) => {
      await client.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    rotate: async (userId, id, next, now) => {
      await findOwned(userId, id);
      const created = await client.refreshToken.create({ data: { userId, ...next } });
      await client.refreshToken.update({
        where: { id },
        data: { revokedAt: now, replacedByTokenId: created.id },
      });
      return created;
    },
    purgeStaleForUser: async (userId, now) => {
      const { count } = await client.refreshToken.deleteMany({
        where: {
          userId,
          OR: [
            { expiresAt: { lt: now } },
            { revokedAt: { lt: new Date(now.getTime() - REVOKED_TOKEN_RETENTION_MS) } },
          ],
        },
      });
      return count;
    },
  };
}

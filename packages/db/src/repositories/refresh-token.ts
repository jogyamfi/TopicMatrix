import { AppError } from '@topicmatrix/shared';
import type { PrismaClientOrTx, RefreshToken } from '../types.js';

export interface CreateRefreshTokenInput {
  tokenHash: string;
  expiresAt: Date;
}

export interface RefreshTokenRepository {
  create(userId: string, input: CreateRefreshTokenInput): Promise<RefreshToken>;
  /** Global lookup by hash — the caller doesn't know which user a presented token belongs to yet. */
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;
  revoke(userId: string, id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export function createRefreshTokenRepository(client: PrismaClientOrTx): RefreshTokenRepository {
  return {
    create: (userId, input) => client.refreshToken.create({ data: { userId, ...input } }),
    findByTokenHash: (tokenHash) => client.refreshToken.findFirst({ where: { tokenHash } }),
    revoke: async (userId, id) => {
      const token = await client.refreshToken.findFirst({ where: { id, userId } });
      if (!token) {
        throw new AppError('NOT_FOUND', 'Refresh token not found');
      }
      await client.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
    },
    revokeAllForUser: async (userId) => {
      await client.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}

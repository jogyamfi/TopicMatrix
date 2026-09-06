import { SignJWT, jwtVerify } from 'jose';
import { ulid } from 'ulid';
import { AppError, type Role } from '@topicmatrix/shared';
import { randomOpaqueToken, sha256Hex } from './crypto-utils.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessTokenClaims {
  userId: string;
  role: Role;
  jti: string;
}

export interface IssuedRefreshToken {
  /** The raw token to send to the client (cookie) — never stored. */
  token: string;
  /** SHA-256 hex digest of `token` — what's persisted in RefreshToken.tokenHash. */
  tokenHash: string;
  expiresAt: Date;
}

export interface TokenService {
  signAccessToken(claims: { userId: string; role: Role }): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
  issueRefreshToken(): Promise<IssuedRefreshToken>;
  hashRefreshToken(token: string): Promise<string>;
}

/** `jwtSecret` is validated to be >= 32 chars by packages/shared's config loader (SEC-5). */
export function createTokenService(jwtSecret: string): TokenService {
  const key = new TextEncoder().encode(jwtSecret);

  return {
    async signAccessToken({ userId, role }) {
      return new SignJWT({ role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setJti(ulid())
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key);
    },

    async verifyAccessToken(token) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, key));
      } catch {
        throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
      }
      const { sub, role, jti } = payload;
      if (typeof sub !== 'string' || (role !== 'ADMIN' && role !== 'LEARNER') || !jti) {
        throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
      }
      return { userId: sub, role, jti: String(jti) };
    },

    async issueRefreshToken() {
      const token = randomOpaqueToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
      return { token, tokenHash, expiresAt };
    },

    hashRefreshToken: sha256Hex,
  };
}

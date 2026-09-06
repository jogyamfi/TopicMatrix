import { describe, expect, it } from 'vitest';
import { AppError } from '@topicmatrix/shared';
import { createTokenService } from './tokens.js';

const jwtSecret = 'a'.repeat(32);

describe('createTokenService — access tokens', () => {
  it('signs and verifies a token round-trip', async () => {
    const service = createTokenService(jwtSecret);
    const token = await service.signAccessToken({ userId: 'user-1', role: 'LEARNER' });
    const claims = await service.verifyAccessToken(token);
    expect(claims.userId).toBe('user-1');
    expect(claims.role).toBe('LEARNER');
    expect(claims.jti).toBeTruthy();
  });

  it('rejects a token signed with a different secret', async () => {
    const service = createTokenService(jwtSecret);
    const other = createTokenService('b'.repeat(32));
    const token = await other.signAccessToken({ userId: 'user-1', role: 'LEARNER' });
    await expect(service.verifyAccessToken(token)).rejects.toThrow(AppError);
  });

  it('rejects a malformed token', async () => {
    const service = createTokenService(jwtSecret);
    await expect(service.verifyAccessToken('not-a-jwt')).rejects.toThrow(AppError);
  });
});

describe('createTokenService — refresh tokens', () => {
  it('issues a unique token each time, hashed consistently', async () => {
    const service = createTokenService(jwtSecret);
    const a = await service.issueRefreshToken();
    const b = await service.issueRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
    expect(await service.hashRefreshToken(a.token)).toBe(a.tokenHash);
  });

  it('sets an expiry roughly 30 days out', async () => {
    const service = createTokenService(jwtSecret);
    const { expiresAt } = await service.issueRefreshToken();
    const days = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});

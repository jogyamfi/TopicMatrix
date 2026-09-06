import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  AppError,
  changePasswordRequestSchema,
  loginRequestSchema,
  normaliseKey,
  roleSchema,
} from '@topicmatrix/shared';
import type { User } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { createTokenService } from '../auth/tokens.js';
import { parseJsonBody } from '../validation.js';
import { recordAudit } from '../audit.js';
import { getAuthUser, requireAuth } from '../middleware/auth.js';

const REFRESH_COOKIE_NAME = 'refreshToken';

// A real, validly-encoded Argon2id hash (default params, fixed all-zero salt) of a fixed,
// non-secret string — NOT anyone's password. Compared against on every login for an unknown
// email so argon2Verify does the full computation either way: an unknown email and a wrong
// password take the same code path and (near enough) the same wall-clock time (§11.2 A07 — never
// disclose whether an email exists).
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$L79NmRawXzamxvGo7kf+MrQzaEsZ6ejFeeYjBeWz19M';

/** HttpOnly; Secure; SameSite=Strict (FR-1.3) — never readable/settable from client script. */
function setRefreshCookie(c: Context<AppEnv>, token: string, expiresAt: Date): void {
  setCookie(c, REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    expires: expiresAt,
  });
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: roleSchema.parse(user.role),
    mustChangePassword: user.mustChangePassword,
  };
}

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.post('/auth/login', async (c) => {
    const deps = c.get('deps');
    const body = await parseJsonBody(c, loginRequestSchema);
    const emailNormalised = normaliseKey(body.email);
    const ip = deps.getClientIp(c);

    const [ipCheck, emailCheck] = await Promise.all([
      deps.rateLimiter.consume(`login:ip:${ip}`),
      deps.rateLimiter.consume(`login:email:${emailNormalised}`),
    ]);
    if (!ipCheck.allowed || !emailCheck.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many login attempts. Try again later.');
    }

    const passwordService = deps.passwordService;
    const user = await deps.db.users.findByEmailNormalised(emailNormalised);
    const passwordOk = await passwordService.verify(
      body.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !user.isActive || !passwordOk) {
      await recordAudit(deps, { action: 'auth.login.failure', metadata: { emailNormalised } });
      throw new AppError('UNAUTHORIZED', 'Invalid email or password');
    }

    if (passwordService.needsRehash(user.passwordHash)) {
      const rehashed = await passwordService.hash(body.password);
      await deps.db.users.update(user.id, { passwordHash: rehashed });
    }

    const tokenService = createTokenService(deps.config.jwtSecret);
    const accessToken = await tokenService.signAccessToken({
      userId: user.id,
      role: roleSchema.parse(user.role),
    });
    const refresh = await tokenService.issueRefreshToken();
    await deps.db.refreshTokens.create(user.id, {
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    });

    setRefreshCookie(c, refresh.token, refresh.expiresAt);
    await recordAudit(deps, { actorId: user.id, action: 'auth.login.success' });

    return c.json({ accessToken, user: toPublicUser(user) });
  });

  app.post('/auth/refresh', async (c) => {
    const deps = c.get('deps');
    const token = getCookie(c, REFRESH_COOKIE_NAME);
    if (!token) {
      throw new AppError('UNAUTHORIZED', 'Missing refresh token');
    }

    const tokenService = createTokenService(deps.config.jwtSecret);
    const tokenHash = await tokenService.hashRefreshToken(token);
    const existing = await deps.db.refreshTokens.findByTokenHash(tokenHash);

    if (!existing || existing.revokedAt || existing.expiresAt.getTime() < deps.clock().getTime()) {
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/' });
      throw new AppError('UNAUTHORIZED', 'Refresh token is invalid or expired');
    }

    const user = await deps.db.users.findById(existing.userId);
    if (!user || !user.isActive) {
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/' });
      throw new AppError('UNAUTHORIZED', 'Account is inactive or no longer exists');
    }

    // Rotating: revoke the presented token, issue a fresh one.
    await deps.db.refreshTokens.revoke(user.id, existing.id);
    const rotated = await tokenService.issueRefreshToken();
    await deps.db.refreshTokens.create(user.id, {
      tokenHash: rotated.tokenHash,
      expiresAt: rotated.expiresAt,
    });
    setRefreshCookie(c, rotated.token, rotated.expiresAt);

    const accessToken = await tokenService.signAccessToken({
      userId: user.id,
      role: roleSchema.parse(user.role),
    });
    return c.json({ accessToken, user: toPublicUser(user) });
  });

  app.post('/auth/logout', requireAuth, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const token = getCookie(c, REFRESH_COOKIE_NAME);

    if (token) {
      const tokenService = createTokenService(deps.config.jwtSecret);
      const tokenHash = await tokenService.hashRefreshToken(token);
      const existing = await deps.db.refreshTokens.findByTokenHash(tokenHash);
      if (existing && existing.userId === user.id && !existing.revokedAt) {
        await deps.db.refreshTokens.revoke(user.id, existing.id);
      }
    }

    deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/' });
    await recordAudit(deps, { actorId: user.id, action: 'auth.logout' });
    return c.json({ status: 'ok' });
  });

  app.post('/auth/change-password', requireAuth, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, changePasswordRequestSchema);

    const passwordService = deps.passwordService;
    const currentOk = await passwordService.verify(body.currentPassword, user.passwordHash);
    if (!currentOk) {
      throw new AppError('UNAUTHORIZED', 'Current password is incorrect');
    }

    const newHash = await passwordService.hash(body.newPassword);
    await deps.db.users.update(user.id, { passwordHash: newHash, mustChangePassword: false });
    await deps.db.refreshTokens.revokeAllForUser(user.id);
    deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/' });

    await recordAudit(deps, { actorId: user.id, action: 'auth.password_changed' });
    return c.json({ status: 'ok' });
  });
}

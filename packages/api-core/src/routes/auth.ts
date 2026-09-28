import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  AppError,
  changePasswordRequestSchema,
  loginRequestSchema,
  normaliseKey,
  roleSchema,
} from '@topicmatrix/shared';
import { changePasswordAndRestartSessions, rotateRefreshToken, type User } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { createTokenService } from '../auth/tokens.js';
import { parseJsonBody } from '../validation.js';
import { recordAudit } from '../audit.js';
import { getAuthUser, requireAuth } from '../middleware/auth.js';

const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * How long a just-rotated refresh token is still honoured. Two tabs whose access tokens expire
 * together both refresh with the SAME cookie: the first rotates it, and without this window the
 * second would be rejected — and its "clear the cookie" response would log BOTH tabs out. Within
 * the window the second request gets an access token and leaves the cookie alone (the browser
 * already holds the successor the first response set). Presenting a rotated token after the
 * window is treated as token theft (§11.2 A07): every session of that user is revoked.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

// A real, validly-encoded Argon2id hash (default params, fixed all-zero salt) of a fixed,
// non-secret string — NOT anyone's password. Compared against on every login for an unknown
// email so argon2Verify does the full computation either way: an unknown email and a wrong
// password take the same code path and (near enough) the same wall-clock time (§11.2 A07 — never
// disclose whether an email exists).
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$L79NmRawXzamxvGo7kf+MrQzaEsZ6ejFeeYjBeWz19M';

/**
 * HttpOnly; Secure; SameSite=Strict (FR-1.3) — never readable/settable from client script.
 * `Secure` can only be dropped with COOKIE_SECURE=false outside production (plain-http trials).
 */
function setRefreshCookie(c: Context<AppEnv>, token: string, expiresAt: Date): void {
  setCookie(c, REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: c.get('deps').config.cookieSecure,
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

    // A successful login clears this email's failed attempts, so a user who mistyped a few times
    // isn't locked out later by old failures. The per-IP counter is deliberately NOT reset:
    // anyone with one valid account could otherwise wipe it and keep guessing at others.
    await deps.rateLimiter.reset(`login:email:${emailNormalised}`);

    // Housekeeping: drop this user's expired and long-revoked refresh tokens.
    await deps.db.refreshTokens.purgeStaleForUser(user.id, deps.clock());

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
    const now = deps.clock();

    if (!existing || existing.expiresAt.getTime() < now.getTime()) {
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/' });
      throw new AppError('UNAUTHORIZED', 'Refresh token is invalid or expired');
    }

    if (existing.revokedAt) {
      const wasRotated = existing.replacedByTokenId !== null;
      const withinGrace = now.getTime() - existing.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
      if (wasRotated && withinGrace) {
        // A concurrent refresh (another tab) — see REFRESH_REUSE_GRACE_MS. No cookie change.
        const user = await deps.db.users.findById(existing.userId);
        if (!user || !user.isActive) {
          throw new AppError('UNAUTHORIZED', 'Account is inactive or no longer exists');
        }
        const accessToken = await tokenService.signAccessToken({
          userId: user.id,
          role: roleSchema.parse(user.role),
        });
        return c.json({ accessToken, user: toPublicUser(user) });
      }
      if (wasRotated) {
        // A long-rotated token being replayed: assume it was stolen, end every session.
        await deps.db.refreshTokens.revokeAllForUser(existing.userId);
        await recordAudit(deps, { actorId: existing.userId, action: 'auth.refresh.reuse_detected' });
      }
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/' });
      throw new AppError('UNAUTHORIZED', 'Refresh token is invalid or expired');
    }

    const user = await deps.db.users.findById(existing.userId);
    if (!user || !user.isActive) {
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/' });
      throw new AppError('UNAUTHORIZED', 'Account is inactive or no longer exists');
    }

    // Rotating: revoke the presented token as replaced by a fresh one, atomically.
    const rotated = await tokenService.issueRefreshToken();
    await rotateRefreshToken(
      deps.db,
      user.id,
      existing.id,
      { tokenHash: rotated.tokenHash, expiresAt: rotated.expiresAt },
      now,
    );
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
      // 422 on the field, not 401: the caller IS authenticated (a 401 would make the client
      // treat it as an expired session and refresh + retry before showing anything).
      throw new AppError('VALIDATION_FAILED', 'Current password is incorrect', {
        currentPassword: 'incorrect',
      });
    }

    // Every other session ends (a changed password should lock out anyone else holding one); this
    // browser gets a fresh session, so changing your password never signs you out here — the
    // forced first-login change included.
    const newHash = await passwordService.hash(body.newPassword);
    const tokenService = createTokenService(deps.config.jwtSecret);
    const refresh = await tokenService.issueRefreshToken();
    const updated = await changePasswordAndRestartSessions(deps.db, user.id, newHash, {
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    });
    setRefreshCookie(c, refresh.token, refresh.expiresAt);
    const accessToken = await tokenService.signAccessToken({
      userId: updated.id,
      role: roleSchema.parse(updated.role),
    });

    await recordAudit(deps, { actorId: user.id, action: 'auth.password_changed' });
    return c.json({ accessToken, user: toPublicUser(updated) });
  });
}

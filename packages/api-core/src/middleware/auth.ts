import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '@topicmatrix/shared';
import type { User } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { createTokenService } from '../auth/tokens.js';

/**
 * Verifies the bearer access token, loads and re-checks the user (rejecting if `isActive` is
 * now false — a revoked account must be locked out immediately, not just at next login), and
 * attaches it as `authUser` for downstream handlers/middleware (P2 task 6).
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get('deps');
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 'Missing or malformed Authorization header');
  }

  const tokenService = createTokenService(deps.config.jwtSecret);
  const claims = await tokenService.verifyAccessToken(header.slice('Bearer '.length));

  const user = await deps.db.users.findById(claims.userId);
  if (!user || !user.isActive) {
    throw new AppError('UNAUTHORIZED', 'Account is inactive or no longer exists');
  }

  c.set('authUser', user);
  await next();
};

/**
 * Reads the user requireAuth attached to the context. A plain `c.get('authUser')!` would need
 * a non-null assertion (banned, no-non-null-assertion) even though requireAuth guarantees it's
 * set by the time a route handler runs — this narrows it with a real (if practically
 * unreachable) runtime check instead.
 */
export function getAuthUser(c: Context<AppEnv>): User {
  const user = c.get('authUser');
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Not authenticated');
  }
  return user;
}

/** Must run after requireAuth. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('authUser');
  if (!user || user.role !== 'ADMIN') {
    throw new AppError('FORBIDDEN', 'Admin role required');
  }
  await next();
};

/**
 * Blocks every route except change-password while `mustChangePassword` is true (FR-1.6). Must
 * run after requireAuth. Every future phase that adds an authenticated route must chain this
 * alongside requireAuth — it is not applied globally because /healthz, /readyz and the
 * pre-authentication /auth/* routes must stay reachable regardless.
 */
export const requirePasswordChanged: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('authUser');
  if (user?.mustChangePassword && c.req.path !== '/auth/change-password') {
    throw new AppError('FORBIDDEN', 'Password change required before continuing', {
      mustChangePassword: true,
    });
  }
  await next();
};

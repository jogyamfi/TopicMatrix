import { Hono } from 'hono';
import type { AppDeps, AppEnv } from './deps.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { corsMiddleware, securityHeadersMiddleware } from './middleware/security.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin-users.js';
import { registerSubjectRoutes } from './routes/subjects.js';
import { registerTopicRoutes } from './routes/topics.js';
import { registerTagRoutes } from './routes/tags.js';

/**
 * Runtime-agnostic Hono app. Takes a deps *factory*, invoked fresh on every request, so
 * neither entrypoint can accidentally reuse a module-level singleton (NF-15): `apps/api` passes
 * `() => buildDeps(process.env)`; `apps/worker` passes `() => buildDeps(env)` from inside `fetch`.
 * No route or service here may import a Node built-in (enforced by ESLint, NF-13).
 */
export function createApp(buildRequestDeps: () => AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('deps', buildRequestDeps());
    await next();
  });
  app.use('*', requestIdMiddleware);
  app.use('*', securityHeadersMiddleware);
  app.use('*', corsMiddleware);
  app.onError(errorHandler);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerSubjectRoutes(app);
  registerTopicRoutes(app);
  registerTagRoutes(app);

  return app;
}

export { buildDeps, createAllowAllRateLimiter } from './deps.js';
export type { AppDeps, AppEnv, AppVariables, RateLimiter, ClientIpResolver, BuildDepsOptions } from './deps.js';
export { createLogger, withFields } from './logger.js';
export type { Logger, LogLevel } from './logger.js';
export { createMemoryRateLimiter } from './rate-limiter.js';
export { requireAuth, requireAdmin, requirePasswordChanged, getAuthUser } from './middleware/auth.js';
export { createPasswordService, createUnavailablePasswordService } from './auth/password.js';
export type { PasswordService, PasswordServiceParams } from './auth/password.js';
export { createTokenService } from './auth/tokens.js';
export type { TokenService, AccessTokenClaims, IssuedRefreshToken } from './auth/tokens.js';
export { randomOpaqueToken, sha256Hex } from './auth/crypto-utils.js';


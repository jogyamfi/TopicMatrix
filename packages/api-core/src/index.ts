import { Hono } from 'hono';
import type { AppDeps, AppEnv } from './deps.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerHealthRoutes } from './routes/health.js';

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
  app.onError(errorHandler);

  registerHealthRoutes(app);

  return app;
}

export { buildDeps, createAllowAllRateLimiter } from './deps.js';
export type { AppDeps, AppEnv, AppVariables, RateLimiter } from './deps.js';
export { createLogger, withFields } from './logger.js';
export type { Logger, LogLevel } from './logger.js';

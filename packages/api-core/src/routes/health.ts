import type { Hono } from 'hono';
import type { AppEnv } from '../deps.js';

/** Both must be served by the same route definition on Node and workerd (P0 acceptance criteria). */
export function registerHealthRoutes(app: Hono<AppEnv>): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // Liveness (`/healthz`) says the process is up; readiness also proves the database answers, so a
  // load balancer or `docker compose` health check stops routing to an API that can't serve.
  app.get('/readyz', async (c) => {
    const deps = c.get('deps');
    try {
      await deps.db.ping();
    } catch (err) {
      deps.logger.error('readiness_check_failed', { message: err instanceof Error ? err.message : String(err) });
      return c.json({ status: 'unavailable', databaseProvider: deps.config.databaseProvider }, 503);
    }
    return c.json({ status: 'ok', databaseProvider: deps.config.databaseProvider });
  });
}

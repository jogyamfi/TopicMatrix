import type { Hono } from 'hono';
import type { AppEnv } from '../deps.js';

/** Both must be served by the same route definition on Node and workerd (P0 acceptance criteria). */
export function registerHealthRoutes(app: Hono<AppEnv>): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', (c) => {
    const deps = c.get('deps');
    // A real dependency check (DB ping) lands once packages/db is a real client at P1.
    return c.json({ status: 'ok', databaseProvider: deps.config.databaseProvider });
  });
}

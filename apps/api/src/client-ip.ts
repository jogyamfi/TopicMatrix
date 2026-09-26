// Node-only: uses @hono/node-server's raw-socket-backed conninfo helper. NF-13 exempts
// apps/api/** from the Node built-ins restriction, and this module is only ever imported from
// apps/api/src/index.ts — never from packages/api-core, which apps/worker also imports.
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { resolveClientIp, type AppEnv } from '@topicmatrix/api-core';

/** The socket address, or — behind `TRUST_PROXY_HOPS` trusted proxies (e.g. the docker-compose
 * nginx) — the client address those proxies recorded in X-Forwarded-For. */
export function getNodeClientIp(c: Context<AppEnv>): string {
  return resolveClientIp(
    getConnInfo(c).remote.address,
    c.req.header('x-forwarded-for'),
    c.get('deps').config.trustProxyHops,
  );
}

// Node-only: uses @hono/node-server's raw-socket-backed conninfo helper. NF-13 exempts
// apps/api/** from the Node built-ins restriction, and this module is only ever imported from
// apps/api/src/index.ts — never from packages/api-core, which apps/worker also imports.
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { AppEnv } from '@topicmatrix/api-core';

export function getNodeClientIp(c: Context<AppEnv>): string {
  return getConnInfo(c).remote.address ?? 'unknown';
}

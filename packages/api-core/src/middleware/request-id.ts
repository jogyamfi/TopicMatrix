import { ulid } from 'ulid';
import type { MiddlewareHandler } from 'hono';
import { withFields } from '../logger.js';
import type { AppEnv } from '../deps.js';

/**
 * An inbound `x-request-id` is only propagated if it looks like an id (ULID/UUID-style characters,
 * at most 64 long): it's echoed into every log line and a response header, so arbitrary client
 * text would let a caller forge or bloat log entries. Anything else gets a fresh ULID.
 */
const TRUSTED_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Generates (or propagates) a ULID per request and includes it in every subsequent log line (NF-7). */
export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const inbound = c.req.header('x-request-id');
  const id = inbound && TRUSTED_REQUEST_ID.test(inbound) ? inbound : ulid();
  c.set('requestId', id);

  const deps = c.get('deps');
  c.set('deps', { ...deps, logger: withFields(deps.logger, { requestId: id }) });

  await next();
  c.header('x-request-id', id);
};

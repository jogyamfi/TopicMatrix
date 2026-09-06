import { ulid } from 'ulid';
import type { MiddlewareHandler } from 'hono';
import { withFields } from '../logger.js';
import type { AppEnv } from '../deps.js';

/** Generates (or propagates) a ULID per request and includes it in every subsequent log line (NF-7). */
export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header('x-request-id') ?? ulid();
  c.set('requestId', id);

  const deps = c.get('deps');
  c.set('deps', { ...deps, logger: withFields(deps.logger, { requestId: id }) });

  await next();
  c.header('x-request-id', id);
};

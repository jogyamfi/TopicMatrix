import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { toErrorEnvelope } from '@topicmatrix/shared';
import type { AppEnv } from '../deps.js';

/** Produces the shared { error: { code, message, details? } } envelope; suppresses detail in production. */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const deps = c.get('deps');
  const exposeDetails = deps.config.nodeEnv !== 'production';
  const { status, body } = toErrorEnvelope(err, { exposeDetails });

  deps.logger.error('unhandled_error', {
    message: err instanceof Error ? err.message : String(err),
    status,
    code: body.error.code,
  });

  // toErrorEnvelope only ever produces 4xx/5xx statuses, all of which carry a body.
  return c.json(body, status as ContentfulStatusCode);
};

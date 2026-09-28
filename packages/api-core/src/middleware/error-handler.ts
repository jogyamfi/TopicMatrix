import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { toErrorEnvelope } from '@topicmatrix/shared';
import type { AppEnv } from '../deps.js';

/** Produces the shared { error: { code, message, details? } } envelope; suppresses detail in production. */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const deps = c.get('deps');
  const exposeDetails = deps.config.nodeEnv !== 'production';
  const { status, body } = toErrorEnvelope(err, { exposeDetails });

  // A 4xx is the caller's mistake (bad input, expired token) — worth a warning, not an alert.
  // A 5xx is ours: log it as an error, with the stack, which never goes to the client.
  const fields = {
    message: err instanceof Error ? err.message : String(err),
    status,
    code: body.error.code,
  };
  if (status >= 500) {
    deps.logger.error('request_failed', { ...fields, ...(err instanceof Error && err.stack ? { stack: err.stack } : {}) });
  } else {
    deps.logger.warn('request_rejected', fields);
  }

  // toErrorEnvelope only ever produces 4xx/5xx statuses, all of which carry a body.
  return c.json(body, status as ContentfulStatusCode);
};

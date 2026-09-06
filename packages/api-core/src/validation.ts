import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { AppError } from '@topicmatrix/shared';

/** Parses and Zod-validates a JSON request body, throwing the shared error envelope on failure. */
export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new AppError('BAD_REQUEST', 'Request body must be valid JSON');
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Validation failed', result.error.flatten());
  }
  return result.data;
}

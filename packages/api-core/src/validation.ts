import type { Context } from 'hono';
import type { z, ZodType } from 'zod';
import { AppError } from '@topicmatrix/shared';

/**
 * Parses and Zod-validates a JSON request body, throwing the shared error envelope on failure.
 * Generic over the schema itself (not just its output) so schemas with a `.transform()` — whose
 * input and output types differ, e.g. `dateOnlySchema`'s `string -> Date` (P5) — still infer
 * correctly; constraining to `ZodType<T>` alone forces input === output === T.
 */
export async function parseJsonBody<S extends ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
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


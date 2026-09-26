import type { Context } from 'hono';
import type { z, ZodError, ZodType } from 'zod';
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
    throw new AppError('VALIDATION_FAILED', describeFirstIssue(result.error), result.error.flatten());
  }
  return result.data;
}

/**
 * A human-readable top-level message naming the first problem, so a client that only shows
 * `error.message` still tells the user what to fix; the full per-field breakdown stays in
 * `details`. Custom (refine) messages are already written for people and are used verbatim;
 * Zod's built-in ones ("Expected number, received string") need the field name for context.
 */
function describeFirstIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Validation failed';
  }
  const field = issue.path.join('.');
  return issue.code === 'custom' || field.length === 0 ? issue.message : `${field}: ${issue.message}`;
}


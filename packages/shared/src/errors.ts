// Single source of truth for API error shapes. Route handlers throw AppError;
// the shared envelope shape keeps client and server in agreement (SRS P0 task 6).
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOPIC_CYCLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  // Moving a topic onto itself or one of its descendants (FR-3.4) — a specific, machine-readable
  // code rather than a generic BAD_REQUEST, per delivery-plan.md P4 acceptance criteria.
  TOPIC_CYCLE: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Internal messages and details of server-side (5xx) failures are suppressed unless
 * exposeDetails is true (prod safety). Client errors (4xx) always carry their message and
 * details: those describe the caller's own request (which field failed validation, that a
 * password change is required) and the client needs them to show the user what to fix.
 */
export function toErrorEnvelope(
  err: unknown,
  opts: { exposeDetails: boolean },
): { status: number; body: ErrorEnvelope } {
  if (err instanceof AppError) {
    const isClientError = err.status < 500;
    const expose = isClientError || opts.exposeDetails;
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: expose ? err.message : 'Internal server error',
          ...(expose && err.details !== undefined ? { details: err.details } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message:
          opts.exposeDetails && err instanceof Error ? err.message : 'Internal server error',
      },
    },
  };
}

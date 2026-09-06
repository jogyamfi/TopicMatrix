// Single source of truth for API error shapes. Route handlers throw AppError;
// the shared envelope shape keeps client and server in agreement (SRS P0 task 6).
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
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

/** Stack traces and internal messages are suppressed unless exposeDetails is true (prod safety). */
export function toErrorEnvelope(
  err: unknown,
  opts: { exposeDetails: boolean },
): { status: number; body: ErrorEnvelope } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(opts.exposeDetails && err.details !== undefined ? { details: err.details } : {}),
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

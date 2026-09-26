// The error every failed API call surfaces — shared by api-client.ts and auth-store.ts (kept in
// its own module so those two don't import each other).

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** The envelope's `details` — for VALIDATION_FAILED, Zod's `flatten()` (`fieldErrors`/`formErrors`). */
  readonly details: unknown;

  constructor(status: number, code: string | undefined, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return new ApiError(
    res.status,
    body?.error?.code,
    body?.error?.message ?? res.statusText,
    body?.error?.details,
  );
}

import type { z } from 'zod';
import { authStore } from './auth-store';

// The typed API client (P6 task 3): every response is parsed through a Zod schema at the
// boundary — a shape mismatch throws loudly instead of producing a silent `undefined` deep in a
// component. Also implements silent-refresh-on-401-then-replay-once (P6 task 5).

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return new ApiError(res.status, body?.error?.code, body?.error?.message ?? res.statusText);
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/** Every call is same-origin via Vite's `/api` proxy in dev, and same-origin Static Assets in
 * production (FR-D.6) — no CORS needed for the browser's own requests. */
async function rawFetch(path: string, token: string | null, opts: ApiFetchOptions): Promise<Response> {
  return fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

export async function apiFetch<S extends z.ZodType>(
  path: string,
  schema: S,
  opts: ApiFetchOptions = {},
): Promise<z.infer<S>> {
  const initialToken = authStore.getState().accessToken;
  let res = await rawFetch(path, initialToken, opts);

  if (res.status === 401 && initialToken) {
    const refreshed = await authStore.refresh();
    if (refreshed) {
      res = await rawFetch(path, refreshed, opts);
    }
  }

  if (!res.ok) {
    throw await toApiError(res);
  }

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Unexpected response shape from ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

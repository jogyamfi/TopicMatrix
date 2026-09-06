// The Worker entrypoint: bindings/config arrive per-request via `env`, never a module
// global (NF-15). No Node built-in may be imported here — enforced by ESLint (NF-13).
import { createApp, buildDeps } from '@topicmatrix/api-core';

export interface WorkerBindings {
  DATABASE_PROVIDER: string;
  DATABASE_URL?: string;
  NODE_ENV?: string;
  JWT_SECRET: string;
  ARGON2_MEMORY_KIB?: string;
  ARGON2_ITERATIONS?: string;
  LOG_LEVEL?: string;
  CORS_ORIGINS?: string;
  DB: D1Database;
}

export default {
  fetch(req: Request, env: WorkerBindings, ctx: ExecutionContext): Response | Promise<Response> {
    const app = createApp(() => buildDeps(env as unknown as Record<string, string | undefined>));
    return app.fetch(req, env, ctx);
  },
};

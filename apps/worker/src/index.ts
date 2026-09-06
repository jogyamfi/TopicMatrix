// The Worker entrypoint: bindings/config arrive per-request via `env`, never a module
// global (NF-15). No Node built-in may be imported here — enforced by ESLint (NF-13).
import { createApp, buildDeps, createUnavailablePasswordService } from '@topicmatrix/api-core';
import { createDb } from '@topicmatrix/db';

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
    const app = createApp(() =>
      buildDeps(env as unknown as Record<string, string | undefined>, {
        createDb,
        // `CF-Connecting-IP` is set by Cloudflare's edge and cannot be spoofed via a
        // client-supplied `X-Forwarded-For` (SEC, FR-1.10). No real rate limiter yet — P11
        // wires the Cloudflare Rate Limiting binding; allow-all (buildDeps' default) until then.
        getClientIp: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
        // hash-wasm (ADR-002) needs dynamic WebAssembly compilation, which Workers disallows
        // ("Wasm code generation disallowed by embedder" — apps/worker/src/argon2-bench.cf.test.ts).
        // Fails loudly rather than silently if any auth route is actually hit; wiring a real
        // Workers-compatible Argon2 implementation is a P11 task.
        createPasswordService: () =>
          createUnavailablePasswordService(
            'Cloudflare Workers disallows dynamic WebAssembly compilation (ADR-002); a ' +
              'Workers-compatible Argon2id implementation is wired at P11.',
          ),
      }),
    );
    return app.fetch(req, env, ctx);
  },
};

# ADR-002: Password hashing — Argon2id parameters and Cloudflare Workers compatibility

**Status:** Accepted
**Date:** 2026-09-06
**Phase:** P2 (gating task 1)
**Closes:** SRS §16 Q8 (partially — see "Open question" below)

## Context

The delivery plan calls for benchmarking `hash-wasm`'s Argon2id implementation inside real
`workerd` (`wrangler dev` / `@cloudflare/vitest-pool-workers`), across memory/iteration settings,
to find parameters meeting current OWASP guidance that fit the Workers free-tier CPU budget
(50 ms per request). The instruction is explicit: **do not weaken the hash to fit the free
tier — escalate instead** if acceptable parameters don't fit.

The spike (`apps/worker/src/argon2-bench.cf.test.ts`, run via `npm run test:cf`) found something
more fundamental than a CPU-budget problem.

## Finding: hash-wasm cannot run on Cloudflare Workers at all

Every attempt to call `hash-wasm`'s `argon2id()` inside real `workerd` fails immediately with:

```
CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder
  at node_modules/hash-wasm/dist/index.esm.js:252 — WebAssembly.compile(asm)
```

This is not a timing/CPU-budget issue — it fails in under 1 ms, before any hashing work happens.
`hash-wasm` embeds its Argon2 implementation as a base64 string, decodes it to bytes at first use,
and calls `WebAssembly.compile()` on that in-memory buffer. Cloudflare's own documentation
([Wasm in JavaScript](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/))
only shows and supports the pattern `import mod from "./simple.wasm"` — a `.wasm` module
statically bundled at build time by `wrangler`/esbuild — followed by `WebAssembly.instantiate(mod, …)`.
Dynamically compiling WebAssembly from an arbitrary in-memory buffer at request time is a
different, disallowed operation: it is exactly the kind of runtime code-generation Workers'
security model blocks by design (the same category as `eval`/`new Function`), matching the
"Wasm code generation disallowed by embedder" V8-embedder restriction observed. This holds for
**every** parameter combination tried — it is a hard platform incompatibility, not something
tunable away.

`apps/worker/src/argon2-bench.cf.test.ts` asserts this failure explicitly and is a standing
regression test: if a future `workerd` release changes this, it will fail loudly here.

## Decision

1. **Keep `hash-wasm` for the Node targets (T1/T2)** — it works well there (see measurements
   below) and is a normal, well-supported dependency on Node.
2. **`PasswordService` construction is a caller-supplied factory**, exactly like `createDb`
   (`packages/api-core/src/deps.ts`'s `BuildDepsOptions.createPasswordService`), not something
   `packages/api-core` constructs itself. `apps/api` passes the real `hash-wasm`-backed
   `createPasswordService`; `apps/worker` passes `createUnavailablePasswordService(reason)`,
   which throws a clear, documented `AppError` if any auth route is actually invoked, rather than
   crashing with a cryptic WASM error deep in a dependency.
3. **A real Workers-compatible Argon2id implementation is deferred to P11** (delivery-plan.md
   P11, which owns wiring the Cloudflare deployment target for real). Candidates to evaluate
   then, in order of preference:
   - A Rust/`wasm-bindgen` Argon2 crate compiled so its `.wasm` output can be statically
     `import`ed (the Cloudflare-supported pattern) instead of dynamically compiled.
   - `@node-rs/argon2` or similar — native-binary based, **not viable on Workers** (no native
     code allowed at all, not just no dynamic Wasm compile).
   - A pure-JS Argon2 implementation — would need its own benchmark; pure-JS Argon2 is
     typically far slower than a WASM/native one, which may or may not fit the CPU budget.
4. **Do not weaken parameters to work around this** — the problem is not that hash-wasm is too
   slow on Workers, it never runs at all. Escalating means: T3 (Cloudflare deployment) does not
   support authentication until P11 resolves this, which is an explicit, recorded scope note
   rather than a silent gap.

## Node measurements (Argon2id via hash-wasm, `packages/api-core/src/auth/password.test.ts`)

Measured on this development machine (single run, `performance.now()` around one `hash()` call
per configuration; not a rigorous multi-run benchmark, but enough to compare candidates):

| Parameters | Avg time |
|---|---|
| 8,192 KiB, t=2, p=1 | ~11 ms |
| 19,456 KiB, t=1, p=1 | ~15 ms |
| 19,456 KiB, t=2, p=1 (current default, `ARGON2_MEMORY_KIB`/`ARGON2_ITERATIONS`) | ~29 ms |
| 46,875 KiB, t=1, p=1 (OWASP's alternative recommendation) | ~37 ms |

All four are comfortably fast enough for a login request on Node (T1/T2) — there is no pressure
to weaken the current default (19,456 KiB, t=2, p=1, matching OWASP's current minimum
recommendation for Argon2id) for performance reasons on Node. The default is left unchanged.

## Consequence for T3 (Cloudflare Workers)

Until P11 wires a working implementation, `apps/worker`'s auth routes will throw `INTERNAL_ERROR`
("Password hashing is unavailable in this runtime…") on first use rather than working or
silently corrupting data. This does not affect T1/T2 (Node) at all, and does not affect NF-11a
(Cloudflare tooling stays optional/dev-only) — it only means the optional Workers deployment
target does not support login yet, which is now an explicit, tracked P11 dependency rather than
an undiscovered runtime bug.

## Open question

SRS §16 Q8 ("Workers plan tier / Argon2id parameters") is **not fully closed** by this ADR — it
assumed the question was purely about CPU budget on a given plan tier. The actual blocker
(hash-wasm's dynamic Wasm compilation) must be resolved by P11 before Q8's original question
(which plan tier, if any) can even be evaluated. P11 should treat "does a Workers-compatible
Argon2id implementation exist and fit the budget" as the first task before revisiting Q8.

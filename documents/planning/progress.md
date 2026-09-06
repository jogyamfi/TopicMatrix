# Progress log

## P0 — Foundation & Runtime Spike

**Status:** Complete.

### What shipped

- npm workspaces monorepo (`apps/{web,api,worker}`, `packages/{core,db,api-core,shared}`), root
  `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
  project references between all packages/apps.
- `createApp(buildRequestDeps)` in `packages/api-core`: a runtime-agnostic Hono app taking a
  **deps factory** (not a fixed deps object), invoked fresh on every request by both entrypoints,
  so neither Node nor Workers can accidentally hold a module-level singleton (NF-15). Both serve
  `GET /healthz` and `GET /readyz` from the same route definitions — verified against both
  `apps/api` (Node) and `apps/worker` (`wrangler dev` / dry-run deploy).
- Zod-validated config loader (`packages/shared/config.ts`): fails closed on missing/short/
  placeholder `JWT_SECRET`; `DATABASE_URL` required only for `sqlite`/`postgresql`, not `d1`
  (task 13).
- Structured JSON logger + ULID request-id middleware; shared error envelope
  (`{ error: { code, message, details? } }`) with detail suppression when `NODE_ENV=production`.
- Prisma multi-provider generation: `prisma/model.prisma` (placeholder `HealthCheck` entity) →
  `scripts/generate-schemas.ts` emits `schema.{sqlite,postgres,d1}.prisma`, each with its own
  generated-client output directory under `packages/db/generated/`. All three generate and the
  SQLite one has a real, applied migration (`prisma migrate dev`).
- **D1 spike (the gating task) — done. Decision: Prisma + `@prisma/adapter-d1`.** Full writeup,
  measurements and rationale in
  [`documents/planning/adr-001-data-access.md`](adr-001-data-access.md). Headline findings:
  - Works end to end against local D1 (`wrangler d1 migrations apply --local`, no Cloudflare
    account needed) — proven by `apps/worker/src/d1-spike.cf.test.ts` running in real `workerd`
    via `@cloudflare/vitest-pool-workers`.
  - D1 has **no real transactions**. Prisma's interactive `$transaction(cb)` throws (safe);
    Prisma's array-form `$transaction([...])` **silently degrades to non-atomic sequential
    queries** — this is the key risk P1's `UnitOfWork` D1 implementation must design around, by
    using D1's native `env.DB.batch([...])` directly instead.
  - Bundle size: baseline 44.68 KiB gzip; +Prisma/adapter-d1 ≈ 867 KiB gzip; +kysely-d1 ≈
    44.76 KiB gzip. Both fit the 3 MB (NF-14) budget; kysely-d1 was evaluated and rejected (see
    ADR) to keep one schema source of truth across all three providers.
- ESLint `no-restricted-imports` rule banning Node built-ins (`node:*`, `fs`, `path`, `crypto`,
  `process`, `Buffer`, …) everywhere except `apps/api/**` (NF-13), verified by moving/adding
  imports and confirming CI-equivalent `npm run lint` catches violations.
- CI (`.github/workflows/ci.yml`): matrix over `sqlite`/`postgresql` running lint → typecheck →
  test → `db:migrate` (proves both providers migrate) → build; a separate bundle-size job
  enforcing the 3 MB compressed Worker limit (NF-14, `scripts/check-bundle-size.mjs`); a
  best-effort (`continue-on-error`) job running the D1 spike suite.
- T1 local loop: `npm run dev` (Vite + Node API, SQLite, zero config beyond `.env.example`),
  `npm run dev:pg`, `db:migrate`/`db:reset`/`db:studio` respecting `DATABASE_PROVIDER`,
  `docker-compose.dev.yml` (PostgreSQL only), `.env.example`, README quickstart. **Verified live**:
  `npm run dev` → `curl http://localhost:5173/api/healthz` → `{"status":"ok"}`.
- Cloudflare tooling kept optional (NF-11a): `wrangler`, `@cloudflare/workers-types`,
  `@cloudflare/vitest-pool-workers` are dev dependencies; default `npm install`/`dev`/`build`/`test`
  never require them or a Cloudflare account. `npm run test:cf` is the separate, skippable script
  for Workers-runtime tests.

### Deferred / not in scope for P0

- Real `User`/`Subject`/`Topic`/… models — P0's Prisma model is a single placeholder entity by
  design (task 7 says this is expected); full schema lands at P1.
- The dependency-audit CI gate (SEC-9) — explicitly a P10 task. Currently there are 15 known
  advisories (2 low/3 moderate/8 high/2 critical), all in **dev-only** Cloudflare tooling
  (`@cloudflare/vitest-pool-workers`'s pinned `miniflare`/`wrangler`/`undici`/`ws`/`sharp`) or
  `vite`/`vitest` itself — none in a runtime dependency. Re-evaluate at P10; may need bumping
  `@cloudflare/vitest-pool-workers` to a version matching a newer Vitest major at that point.
- `apps/worker/src/d1-spike.cf.test.ts` is a genuine regression test (not throwaway placeholder
  code) proving the ADR-001 decision continues to hold; P1 should fold its assertions into real
  `UnitOfWork` tests once that abstraction exists, rather than deleting it outright.
- `driverAdapters` is flagged deprecated-but-functional by Prisma 6.19 (stable without the preview
  flag now) — worth dropping from `previewFeatures` in `prisma/model.prisma` generation at P1.

### Decisions taken

- **Data access on D1: Prisma + `@prisma/adapter-d1`**, with atomic multi-statement writes on D1
  implemented via raw `env.DB.batch()`, never Prisma `$transaction()`. See ADR-001.
- `createApp` takes a deps **factory** (`() => AppDeps`), not a fixed `AppDeps` object — this was
  a deliberate correction during P0: the initial scaffold built `AppDeps` once at Node module
  scope, which satisfied NF-15's letter loosely but not its intent. Both entrypoints now rebuild
  deps per request identically.
- Root `package.json` is `"type": "module"` (was `"commonjs"`, which broke the ESM
  `eslint.config.js` and root scripts).

### Environment notes for whoever runs this next (this machine only, not project decisions)

Recorded in full in repo memory (`/memories/repo/environment.md`); summary:

- Corporate proxy blocks some exact package-version binary downloads (old `esbuild` versions
  bundled by `vite`/`wrangler`, and `devalue`). Fixed via root `package.json` `overrides`
  (`esbuild`, `devalue` pinned to versions that do install).
- `npx prisma generate`/`migrate` needs `NODE_OPTIONS="--use-system-ca"` on this machine (Node's
  bundled CA list doesn't include this machine's corporate root CA, which the Windows system
  store does have).
- Vite's default `build.target` breaks under the overridden `esbuild` version — fixed with an
  explicit `build.target: 'es2022'` in `apps/web/vite.config.ts`.

### Handover to P1

- The D1 transaction caveat (above) is the single most important thing P1's `UnitOfWork` design
  must account for — do not assume `prisma.$transaction()` gives atomicity on the D1 provider.
- `prisma/model.prisma` currently has one placeholder entity (`HealthCheck`); P1 replaces it with
  the full SRS §6 model and must re-run `npm run db:generate-schemas` + regenerate all three
  Prisma clients (see README/ADR for the exact commands, including the `--use-system-ca` note if
  running on a similarly-proxied machine).
- `packages/db/src/index.ts` is still a placeholder (`createPlaceholderDb`); P1 replaces it with
  real repositories per SRS §14.4/P1 tasks 6–7.

## P1 — Data Model & Persistence Layer

**Status:** Complete (PostgreSQL path implemented but **not runtime-verified** — no Docker on
this development machine; see Deferred section).

### What shipped

- **Full SRS §6 schema** in `prisma/model.prisma`: `User`, `UserSettings`, `Subject`, `Topic`,
  `StudySession`, `ReviewSchedule`, `CompetencySnapshot`, `Tag`, `TopicTag`, `RefreshToken` (the
  P0 `HealthCheck` placeholder is kept alongside it, still used by `/readyz` and the D1 spike
  test). No `enum`/`Json`/`Decimal`/`@db.*`/arrays anywhere (§6.3). Case-insensitive uniqueness via
  `*Normalised` companion columns (`packages/shared/normaliseKey`), enforced at the DB level for
  `User.email`, `Subject.name` (per user) and `Tag.name` (per user). Every relation uses
  `onDelete: Restrict` — no DB-level cascades anywhere; multi-step deletes must go through a
  `UnitOfWork` in dependency order (§14.4's D1 rationale, applied uniformly to all providers for
  consistency). All §6.2 indexes present.
  - **Deliberate scope decision**: `Topic` sibling-name uniqueness (FR-3.3) is **not** a DB
    constraint. Both SQLite and PostgreSQL treat `NULL` as distinct-from-`NULL` in unique indexes,
    so `@@unique([subjectId, parentId, nameNormalised])` would silently fail to catch duplicate
    **root-level** (`parentId = null`) topic names. Left as P4 application-level validation;
    documented in a schema comment.
- **Restructured `prisma/` layout** (a correction to P0's, made necessary once real migrations
  existed): each provider's generated schema now lives in its own subdirectory —
  `prisma/sqlite/schema.prisma`, `prisma/postgres/schema.prisma`, `prisma/d1/schema.prisma` — each
  with its own committed `migrations/` + `migration_lock.toml`. Reason: Prisma resolves a schema's
  migrations directory as `<schema file's directory>/migrations`; with all three schemas
  previously sitting directly in `prisma/`, they would have shared **one** migrations folder, and
  SQLite/PostgreSQL migration SQL dialects diverge. `scripts/generate-schemas.ts`,
  `scripts/db-{migrate,reset,studio}.mjs`, `.gitignore` and the README were all updated to match.
  - SQLite: real migration applied via `prisma migrate dev` (`prisma/sqlite/migrations/
    20260906145617_p1_full_schema/`, on top of P0's `20260906122251_init`).
  - PostgreSQL: **no live server available** (no Docker on this machine). Generated an initial
    migration **offline**, with no DB connection needed:
    `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/postgres/schema.prisma --script`
    → `prisma/postgres/migrations/20260906150000_init/migration.sql`. This has **not** been
    applied against a real PostgreSQL instance — do that (`npm run test:integration:pg`) before
    trusting it, on a machine with Docker.
  - D1: `apps/worker/migrations/0001_init.sql` regenerated the same way, covering the full schema
    (was HealthCheck-only from P0).
  - Along the way, corrected a P0 handover note: `prisma generate --no-engine` is **not** for
    driver-adapter (D1) clients — it's an incompatible engine mode. D1's client is generated with
    plain `prisma generate` (no flags), which also turned out to no longer need the
    `driverAdapters` preview feature at all on Prisma 6.19 (verified via `npm run test:cf`
    continuing to pass, 4/4).
- **Repository layer**, `packages/db/src/repositories/`: one module per aggregate (`user`,
  `user-settings`, `subject`, `topic`, `study-session`, `review-schedule`,
  `competency-snapshot`, `tag`, `refresh-token`). Every method takes `userId` first (except
  `User` itself, which *is* the owning identity) and verifies ownership by joining up to the
  owning user — direct `userId` filter for `StudySession` (denormalised per §6.1), a join through
  `subject` for `Topic` and everything hanging off it. Reads return `null` for missing-or-not-
  owned; writes throw `AppError('NOT_FOUND', …)`. `Topic.create` computes the materialised `path`/
  `depth` correctly for the initial-insert case (full subtree move/rewrite logic is P4 scope).
  `StudySession.accuracy` is always computed server-side from `questionsCorrect`/
  `questionsAttempted`, never accepted as input (anticipates FR-4.2).
- **`UnitOfWork`** (`packages/db/src/unit-of-work.ts`): `run<T>(work)` interface. SQLite/PostgreSQL
  implementation wraps Prisma's real interactive `$transaction`. The D1 implementation
  **intentionally throws** with a detailed explanation rather than faking atomicity it can't
  deliver — D1 has no interactive transactions, and its only genuinely atomic primitive
  (`env.DB.batch()`) needs a fixed, upfront list of prepared statements, which is a fundamentally
  different shape from "run this arbitrary callback atomically". Wiring D1's real implementation
  is explicitly a P11 task (delivery-plan.md P11 task 3) once a live Workers binding exists to
  build and test it against.
- **`packages/shared` additions**: `date.ts` (`toUserDate`, `startOfUserDay`, `addDays` — all
  DST-safe, `Intl`-based, no fixed-UTC-offset math), `normalize.ts` (`normaliseKey`), `domain.ts`
  (`Role`/`Algorithm`/`Theme`/`TopicDeleteMode` Zod schemas + inferred TS unions,
  `manualIntervalsJson` parse/stringify helpers). 28 new unit tests, including an explicit
  DST-boundary round-trip test (Europe/London, October 2026 fall-back) and its integration-test
  counterpart (same proof through a real DB round-trip).
- **Test fixtures** (`packages/db/src/fixtures.ts`): `createUser`, `createUserWithSettings`,
  `createSubject`, `createTopic`, `createTopicChain`, `createStudySession` — every value defaults
  to something valid-but-unique so tests never collide, even against a shared DB.
- **Integration test harness**: `vitest.integration.config.ts` (new), `packages/db/test/setup.ts`
  (provisions a real, migrated scratch database — a temp SQLite file by default, or a live
  PostgreSQL via `DATABASE_PROVIDER=postgresql`), `packages/db/test/repositories.integration.
  test.ts` — **25 tests** against a real database: every repository has an explicit cross-user
  isolation test (acceptance criterion), plus `UnitOfWork` commit/rollback-on-throw, plus the
  materialised-path chain, plus the DST round-trip stored via a real `StudySession.studiedOn`.
  `npm run test:integration` (SQLite, runs today) / `npm run test:integration:pg` (needs
  `docker-compose.dev.yml` — **not run this phase**, no Docker on this machine).
- **Demo seed** (FR-D.10): `npm run seed:demo` → `apps/api/src/seed-demo.ts`. One demo user
  (`demo@example.com`), 3 subjects, a 2–3-level topic tree (14 topics total), back-dated sessions
  (62 total) with a snapshot per session (62), and a `ReviewSchedule` per topic deliberately spread
  across overdue / due-today / due-soon / future buckets so the review queue (P8) and retention
  charts (P9) have real variety to build against without hand-entering data. Verified by running
  it against the real SQLite dev database and checking row counts.

### A real bug found and fixed while implementing this (worth reading before P2+)

Wiring a real Prisma client into `packages/db`'s main barrel **broke `npm run test:cf`** even
though the `d1` provider branch never executed anything Node-specific: `index.ts` re-exported
`createPrismaClient`, a *value* import that unconditionally loads **both** the SQLite and
PostgreSQL generated Prisma clients. Prisma's regular (non-driver-adapter) generated client
needs Node built-ins (`node:child_process` etc.) just to be *imported*, not just to run a query.
Because `packages/api-core` (shared by both entrypoints) imported from that barrel, and
`apps/worker` imports `api-core`, `wrangler`/esbuild bundled that Node-only code into the Worker
and it failed at runtime with `No such module "node:child_process"`.

**Fix**: split `packages/db` into a runtime-agnostic main barrel (`Db` interface, repositories,
`UnitOfWork`, a `createDb()` that only ever returns a `d1` stub) and a new Node-only subpath,
`@topicmatrix/db/node` (`createNodeDb`, the only place that imports the SQLite/PostgreSQL
clients). `packages/api-core`'s `buildDeps` was changed to take the db-construction function as a
**parameter** rather than importing one concretely (`buildDeps(env, createDb)`) — `apps/api`
passes `createNodeDb`, `apps/worker` passes the main barrel's `createDb`. This is now re-verified
by `npm run test:cf` passing (it's the regression test that would catch this again).

**Lesson for every phase from here on**: nothing reachable from `packages/api-core`'s import
graph may statically import a Node-only implementation, even indirectly through a shared barrel
file, even behind a branch that's never taken for the Workers target. A clean `lint`/`typecheck`
pass does **not** catch this — only actually running `npm run test:cf` does. Treat that command
as load-bearing for every future phase that touches `packages/api-core` or `packages/db`.

### Deferred / not in scope for P1

- **PostgreSQL is implemented but unverified at runtime** — no Docker available on this
  development machine. The schema, the offline-generated initial migration, and the
  `test:integration:pg` script all exist and *should* work (the SQLite path they're structurally
  identical to is fully verified), but nobody has run `prisma migrate deploy` or the integration
  suite against a real PostgreSQL instance yet. **Do this before trusting it** — first task for
  whoever next has Docker available.
- **D1 repositories are not wired** — `createDb()` returns a `Db` whose repository methods throw
  a clear, documented error for `d1` (rather than silently pretending to work). This is
  deliberate: D1 needs a live Workers `D1Database` binding that this function doesn't have, and
  wiring it is explicitly a P11 task (delivery-plan.md P11 task 3). `/healthz`/`/readyz` never
  touch `deps.db`'s repositories, so `wrangler dev` is unaffected.
- **Topic sibling-name uniqueness (FR-3.3)** is not a DB constraint (NULL-distinctness quirk on
  both providers — see above); P4 must validate it at the application level when implementing
  topic create/rename.
- **`/readyz`'s real DB ping** (a P0-authored aspiration in a code comment, not an explicit P1
  task) was deliberately *not* implemented: doing it properly would add real filesystem/DB side
  effects to `packages/api-core/src/index.test.ts`, which is currently a fast, pure unit test.
  Worth revisiting alongside connection-lifecycle management, not as a drive-by addition.
- Full topic-tree operations (move/re-parent, cycle prevention, batch path rewrites, cascade vs.
  promote delete) are P4 scope — P1's `topics.create` only computes a correct initial `path`/
  `depth`; there is no `move` yet.

### Decisions taken

- All relations use `onDelete: Restrict`, never a DB-level cascade, on every provider (not just
  D1) — for consistency and because it makes a forgotten explicit-deletion step in a `UnitOfWork`
  fail loudly instead of silently cascading.
- `packages/db`'s Node/Workers split (see bug writeup above) — `@topicmatrix/db/node` is now the
  permanent home for anything that touches the SQLite/PostgreSQL Prisma clients.
- `UnitOfWork`'s D1 implementation throws rather than faking atomicity — see rationale above.

### Handover to P2

- `packages/db` exports everything P2 needs: `users`/`userSettings`/`refreshTokens`
  repositories, `createFixtures`, and the `Db`/`UnitOfWork` types. Password hashing, JWT/token
  services, auth routes and middleware are all still to build.
- Use `createNodeDb` (via `@topicmatrix/db/node`) from `apps/api`-side code only; use the main
  `@topicmatrix/db` barrel's `createDb` everywhere else (it's what `buildDeps` is already wired
  to for the Worker target). Do not add a new direct import of the SQLite/PostgreSQL generated
  clients anywhere outside `packages/db/src/{client,node}.ts` — see the bug writeup above.
- `seed-admin.ts` is still the P0 placeholder (refuses to run, `exitCode = 1`) — P2 implements it
  for real now that `User`/`UserSettings` repositories exist.
- Verify PostgreSQL for real (see Deferred) before building anything that assumes it works.

## P2 — Identity, Sessions & Access Control

**Status:** Complete (Node/SQLite path fully verified; PostgreSQL inherits P1's "generated but
not runtime-tested here" status; Cloudflare Workers path has a real, documented gap — see below).

### What shipped

- **⚠️ Argon2id/Workers spike (the gating task) — done, with an unexpected result.**
  `apps/worker/src/argon2-bench.cf.test.ts` proves, inside real `workerd`
  (`@cloudflare/vitest-pool-workers`), that `hash-wasm`'s Argon2id **cannot run on Cloudflare
  Workers at all**: it fails instantly with `WebAssembly.compile(): Wasm code generation
  disallowed by embedder`, because hash-wasm dynamically compiles WebAssembly from an in-memory
  buffer at runtime, and Workers only permits statically-`import`ed `.wasm` modules bundled at
  build time. This is a hard platform incompatibility, not a CPU-budget problem — full writeup,
  Node-side timing measurements for the candidate parameter sets, and the decision in
  [`documents/planning/adr-002-password-hashing.md`](adr-002-password-hashing.md). Per the
  instruction to escalate rather than weaken the hash: the chosen default (19,456 KiB, t=2, p=1)
  is unchanged, `PasswordService` construction became a caller-supplied factory
  (`BuildDepsOptions.createPasswordService`, mirroring `createDb`), `apps/api` wires the real
  hash-wasm-backed one, and `apps/worker` wires `createUnavailablePasswordService(reason)` (fails
  loudly and clearly if ever hit, rather than crashing deep in a dependency). **Wiring a real
  Workers-compatible Argon2id implementation is now an explicit P11 dependency** — do not attempt
  to fix this by weakening parameters; see the ADR's "Decision" section for candidates to
  evaluate at P11.
- **Password service** (`packages/api-core/src/auth/password.ts`): `hash`/`verify`/`needsRehash`
  over hash-wasm's Argon2id, PHC-encoded hashes (self-describing — no separate salt/params
  storage needed). Minimum length 12 + a small bundled common-password deny list
  (`packages/shared/src/password-policy.ts`, SEC-3), enforced via Zod (`changePasswordRequestSchema`).
- **Token service** (`packages/api-core/src/auth/tokens.ts`) using `jose`: 15-minute HS256 access
  JWT (`sub`, `role`, `jti`, `exp`); 30-day opaque refresh token, generated and hashed via Web
  Crypto only (`crypto.getRandomValues`/`crypto.subtle.digest`, no `node:crypto` — works
  identically on Node and would work on Workers too, unlike Argon2).
- **Auth routes** (`packages/api-core/src/routes/auth.ts`): `POST /auth/login` (generic
  "Invalid email or password" for unknown email, wrong password, AND inactive account alike —
  §11.2 A07 — verified via a fixed real dummy Argon2 hash so an unknown email still pays the full
  hashing cost, for comparable timing), `/auth/refresh` (rotating: old token revoked, new one
  issued and set), `/auth/logout` (revokes the presented refresh token), `/auth/change-password`
  (revokes **all** the user's refresh tokens and clears `mustChangePassword`). Refresh token is an
  `HttpOnly; Secure; SameSite=Strict` cookie (FR-1.3), never returned in a JSON body.
- **Middleware** (`packages/api-core/src/middleware/auth.ts`): `requireAuth` (verifies the bearer
  JWT, reloads the user, rejects if no longer `isActive`), `requireAdmin`, `requirePasswordChanged`
  (blocks every route except `/auth/change-password` while `mustChangePassword` is true, FR-1.6 —
  applied so far to `/admin/*`; every future phase adding authenticated routes must chain it too).
- **Rate limiting** (`packages/api-core/src/rate-limiter.ts`): a real in-memory `RateLimiter` —
  10 attempts / 15 min, keyed by IP **and** by normalised email independently (FR-1.10) — wired
  into `apps/api` as a genuine, deliberate exception to "rebuilt per request" (a rate limiter
  needs cross-request state to mean anything; constructed once at Node module scope, the same
  instance passed into every `buildDeps` call). `apps/worker` still gets `createAllowAllRateLimiter`
  — a real Workers-binding-backed limiter is P11 scope, same as the D1 repositories.
- **Client IP resolution** (`ClientIpResolver`, another caller-supplied `buildDeps` factory):
  `apps/api` uses `@hono/node-server/conninfo`'s real socket address; `apps/worker` uses the
  Cloudflare-trusted `CF-Connecting-IP` header (never raw `X-Forwarded-For`, SEC).
- **Admin user management** (`packages/api-core/src/routes/admin-users.ts`), all under
  `requireAuth, requirePasswordChanged, requireAdmin`: `GET/POST /admin/users`,
  `PATCH/DELETE /admin/users/:id`. Create issues a random temporary password (shown once in the
  response only, never logged/stored in plaintext) with `mustChangePassword=true`; delete requires
  an explicit `{ confirm: true }` body field (FR-1.8) and cascades the ENTIRE account — subjects,
  topics, sessions, schedules, snapshots, tags, tag associations, refresh tokens, settings — inside
  one `UnitOfWork` in dependency order (`packages/db/src/account-deletion.ts`'s
  `deleteUserAccount`, since every relation is `onDelete: Restrict`, P1). A test proves no
  `/admin` route ever exposes subjects/topics/sessions (SRS §16 Q7).
- **Audit logging** (`packages/api-core/src/audit.ts` + a new `AuditLog` model/repository,
  `packages/db/src/repositories/audit-log.ts`): auth success/failure, logout, password change,
  and every admin user-management action — actor id, action, target id, small non-PII metadata,
  timestamp. Deliberately **not** a DB relation to `User` (an audit row must outlive the user it
  describes being deleted); a failed audit write is logged and swallowed, never breaks the
  request it's attached to.
- **Security headers + CORS** (`packages/api-core/src/middleware/security.ts`, via `hono/secure-headers`
  and `hono/cors`): CSP with no `unsafe-inline`, HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` (SEC-6) applied globally; CORS reflects only an allow-listed
  origin from `config.corsOrigins`, read fresh per request (SEC-7).
- **`seed-admin.ts` implemented for real** (FR-1.9): refuses to run if any user exists, creates
  the first `ADMIN` with a random temporary password (printed once) and `mustChangePassword=true`.
- **A real, pre-existing bug found and fixed along the way**: `seed-demo.ts` (P1) imported
  `createDb` from the main `@topicmatrix/db` barrel (which only ever constructs a `d1` stub) —
  `npm run seed:demo` had been broken since whenever that barrel split landed and nobody had run
  it since. Fixed to import `createNodeDb` from `@topicmatrix/db/node`, same as every other
  Node-context caller; re-verified end to end (`npm run db:reset && npm run seed:admin && npm run
  seed:demo`).
- **Tests**: 61 unit tests (password hashing incl. Node timing numbers for the ADR, token
  sign/verify, rate limiter, Zod schemas, security headers, CORS), 40 SQLite integration tests
  covering the full login → refresh-rotation → logout cycle, rate-limit 429 on the 11th attempt,
  change-password revoking existing sessions, every admin CRUD path, LEARNER 403 on every
  `/admin` route, unauthenticated 401, `mustChangePassword` lockout, cascade-delete, and the
  explicit-confirm-required delete guard. Plus the `argon2-bench.cf.test.ts` Workers-incompatibility
  regression test (`npm run test:cf`).

### Deferred / not in scope for P2

- **A working Argon2id implementation for Cloudflare Workers** — see the spike finding above.
  `apps/worker`'s auth routes will throw a clear `INTERNAL_ERROR` if actually invoked until P11
  resolves this. This does not affect T1/T2 (Node) or NF-11a (Cloudflare tooling stays optional).
- **A real Workers-binding rate limiter** — `apps/worker` still uses allow-all; P11 wires
  Cloudflare's Rate Limiting API, same phase that wires D1 repositories.
- Self-registration doesn't exist (by design — all users are admin-created, FR-1.8/FR-1.9).
- No protection yet against an admin deleting/disabling their own account (last-admin lockout) —
  not called for by any P2 requirement; worth a look if it becomes a real support headache.

### Decisions taken

- **`PasswordService`, `RateLimiter`, and `ClientIpResolver` are all caller-supplied factories
  in `BuildDepsOptions`**, exactly like `createDb` — the P1 lesson ("nothing reachable from
  api-core's shared import graph may assume a Node-only or Workers-only implementation") now
  applies to three things, not just the DB.
- Login failures are indistinguishable (status, body, and — as far as a fixed dummy Argon2 hash
  can achieve — timing) for unknown email, wrong password, and inactive account alike.
- Account deletion cascades are hand-written raw-Prisma deletes inside `UnitOfWork.run`
  (`packages/db/src/account-deletion.ts`) rather than repository methods, since it's a rare,
  whole-account, cross-every-aggregate operation — revisit if a second caller needs it.

### Handover to P3/P4

- P3 (domain engine) has no dependency on P2 and can proceed independently, as planned.
- P4 (subjects/topics API) will be the first phase to add authenticated, per-user-resource
  routes: remember to chain `requireAuth` (and `requirePasswordChanged`) on every one of them,
  and to write the cross-user 404 (not 403) test for every new repository method, per the P1/P2
  convention.
- Whoever picks up P11: start with ADR-002's "Decision" section (candidate Workers-compatible
  Argon2id implementations) before touching anything else Workers-auth-related — the D1
  repositories, D1 `UnitOfWork`, and now Argon2id are the three things P11 must wire for real.

## P3 — Core Domain Engine

**Status:** Complete. Ran independently of P1/P2 as planned; no dependency on either.

### What shipped

- **`packages/core`** — zero I/O, zero runtime dependency other than `ts-fsrs`; every function
  takes `asOfDate`/`reviewedOn` explicitly, never reads the clock. 66 unit tests (97% line
  coverage on `packages/core`, self-verified locally with `@vitest/coverage-v8` — see Deferred;
  well clear of NF-6's 90% target).
- **Competency scoring (§7)**, `src/scoring.ts`: `computeCompetencyScore` (recency/accuracy/
  confidence-weighted composite, §7.1) returns `null` — never `0` — for zero sessions, and an
  `isProvisional` flag while fewer than 3 sessions exist (§7.2). `computeRollupScore` (§7.3),
  `computeHealthStatus` (§7.4), `computeProgressStatus` (§7.5), plus `roundScoreForStorage`
  (1dp)/`roundScoreForDisplay` (integer) and `validateScoringWeights`. Table-driven tests include
  the boundary cases the plan calls out by name (accuracy exactly 0.40/0.90, recency component
  exactly `exp(-1)` when overdue equals the interval) and a monotonicity property test.
- **Outcome → grade mapping (§8.1, FR-5.4)**, `src/grade.ts`: `computeGrade`, evaluated in an
  explicit order (accuracy floor → easy ceiling → good → hard) to resolve the two cases where the
  table's conditions overlap — documented in the module's own comments, tested at every named
  boundary (`p` = 0.45/0.65/0.85, `a` = 0.40/0.90).
- **Schedulers (§8.2-8.5)**, `src/schedulers/`: `fsrsScheduler` (thin `ts-fsrs` wrapper, requested
  retention 0.90), `sm2Scheduler` (hand-written, EF floor 1.3, verified against the classic
  all-"Good" SuperMemo-2 worked example — EF constant at 2.5, intervals 1/6/15/38...), `manualScheduler`
  (ladder from `SchedulerSettings.manualIntervals`, falling back to `packages/shared`'s
  `DEFAULT_MANUAL_INTERVALS`). `schedulers/registry.ts` maps `Algorithm` → `Scheduler`; adding a
  4th algorithm is one file plus one registry entry (FR-5.8).
- **Replay (§8.6)**, `src/replay.ts`: `replaySchedule` folds a topic's full session history,
  sorted chronologically, through a `Scheduler` from a null initial state. `resolveSessionGrade`
  prefers a persisted `gradeUsed` override over the computed grade (FR-5.4). Property-tested:
  order-independent (sessions passed out of order replay identically), idempotent, and
  prefix-then-remainder equals replaying the whole history — for all three schedulers.
- **FSRS verification**: rather than hand-transcribing `ts-fsrs`'s internal fixtures (not
  practically extractable from outside the library), `fsrs-scheduler.test.ts` drives a mixed-grade
  sequence through both `fsrsScheduler` and a directly-constructed `ts-fsrs` engine with identical
  parameters, asserting the wrapper's stability/difficulty/interval/reps/lapses match at every
  step. This catches wrapper bugs (wrong field mapping, wrong `Card` reconstruction, wrong
  rounding) without re-deriving FSRS's own math.

### Decisions taken (read before touching scheduling/scoring again)

- **`Scheduler.id` uses `packages/shared`'s lower-case `Algorithm` union** (`'fsrs'|'sm2'|'manual'`,
  also `ReviewSchedule.algorithm`'s stored string) instead of the SRS §8.5 pseudocode's illustrative
  `'FSRS'|'SM2'|'MANUAL'` casing — one spelling of the three identifiers, not two.
- **FSRS runs with `enable_short_term: false` and `enable_fuzz: false`**, not `ts-fsrs`'s own
  defaults. Short-term/Anki-style learning steps (minutes-granularity) are meaningless against a
  date-only `studiedOn`/`nextReviewOn` schema (§6.3); fuzz would break replay's determinism
  (§8.6/NF-6). `FSRS_REQUESTED_RETENTION = 0.90` per §8.2; there is no per-user override for it in
  `UserSettings` (only `manualIntervalsJson`/weights/thresholds are user-tunable, FR-8.1/8.2).
- **FSRS interval floor of 1 day**: `fsrsScheduler` clamps `scheduled_days` to `>= 1`, since a
  date-only system can't represent "review again later today". Same floor is implicit in SM-2/
  Manual by construction.
- **`ScheduleState` is one shared shape across all three algorithms**, deliberately matching
  `ReviewSchedule`'s scheduling columns 1:1 (`lastReviewedOn`, `intervalDays`, `repetitions`,
  `lapses`, `easeFactor`, `stability`, `difficulty`, `manualLadderIndex`) — each algorithm only
  populates its own fields, leaving the rest `null`. This is what makes swapping a topic's
  algorithm (FR-5.7) a matter of re-running replay with a different `Scheduler`, not a schema
  migration.
- **Roll-up (§7.3) fallback**: when every scored descendant's trailing-180-day question count is
  zero (there's history, just none recent), `computeRollupScore` falls back to an unweighted mean
  rather than returning `null`. The SRS doesn't specify this edge case; flagged for P4/P9 to
  confirm it reads right once it's on screen.
- **Progress status (§7.5) ordering**: a topic can satisfy both "due today" and "Mastered"
  simultaneously (a long stable interval elapsing *is* what due means); `computeProgressStatus`
  resolves this by returning `needsReview` first, since that's the actionable state. Also flagged
  for P7/P9 to confirm against the actual UI.

### Deferred / not in scope for P3

- **No CI coverage gate** — NF-6's "enforced in CI" half is explicitly a P10 task (see the
  requirement coverage map). This phase only self-verified ≥90% line coverage locally
  (`@vitest/coverage-v8`, installed with `--no-save` and not committed — add it for real, and wire
  the gate, at P10).
- **FSRS interval ceiling (open question Q3)** — `maximum_interval` was left at `ts-fsrs`'s own
  default; deciding on a product-specific ceiling is explicitly a P5 task per the plan's open
  questions table.
- Everything about *wiring* scoring/scheduling into the API (persisting `ScheduleState` into
  `ReviewSchedule`, computing `questionsAttempted180d` for roll-up, deriving `overdueDays`/
  `daysSinceLastSession`/`isDueOrOverdue`/`lapseInLastThreeSessions` from real data) is P4/P5
  scope, per the plan — P3 only had to make the pure functions correct and testable.

### Handover to P4/P5

- `packages/core`'s public surface (barrel: `src/index.ts`) is the complete P3 deliverable:
  `computeCompetencyScore`, `computeRollupScore`, `computeHealthStatus`, `computeProgressStatus`,
  `computeGrade`, `getScheduler`/`schedulerRegistry`, `replaySchedule`, `resolveSessionGrade`, and
  the `ScheduleState`/`SchedulerSettings`/`Scheduler` types. P5 (the phase that actually persists
  `ReviewSchedule` and `CompetencySnapshot`) is the first consumer.
- P4/P5 own translating real `Topic`/`StudySession`/`ReviewSchedule` rows into this package's input
  shapes (`ScoringSessionInput`, `ReplaySessionInput`, `TopicScoreForRollup`, `HealthStatusInput`,
  `ProgressStatusInput`) — none of those exist as DB-shaped types in `packages/core` on purpose,
  to keep it decoupled from `packages/db`.
- The two flagged judgment calls above (roll-up zero-weight fallback, progress-status ordering)
  are the two most likely things to need revisiting once real data and a real UI exist.

## P4 — Subjects & Topic Tree API

**Status:** Complete (SQLite path verified; PostgreSQL inherits P1's "generated but not
runtime-tested here" status; Cloudflare Workers path unaffected — `npm run test:cf` still green).

### What shipped

- **Subject routes** (`packages/api-core/src/routes/subjects.ts`), all under
  `requireAuth, requirePasswordChanged`: `GET/POST /subjects`, `GET/PATCH/DELETE /subjects/:id`,
  `GET /subjects/:id/tree`. Name uniqueness (FR-2.2) is enforced with a pre-check in the
  repository (`packages/db/src/repositories/subject.ts`, same "check first" convention as
  admin-users.ts rather than catching the DB's unique-constraint error) — case-insensitive per
  user, on both create and rename. Delete requires an explicit `{ confirm: true }` body field
  (FR-2.4) and cascades topics/sessions/schedules/snapshots/tag-associations inside one
  `UnitOfWork` (`packages/db/src/subject-deletion.ts`'s `deleteSubjectCascade`), same pattern as
  P2's `deleteUserAccount`.
- **Topic routes** (`packages/api-core/src/routes/topics.ts`): `GET /topics?subjectId=` (query
  param required, 400 without it), `POST /topics`, `GET/PATCH/DELETE /topics/:id`,
  `POST /topics/:id/move`. Sibling-name uniqueness (FR-3.3) — flagged at P1 as an
  application-level concern (NULL-distinctness on both providers, see prisma/model.prisma's
  comment) — is now enforced in `packages/db/src/repositories/topic.ts`'s `create`/`update`, and
  again in `topic-tree.ts`'s `moveTopic` (moving into a new parent can create a fresh collision).
- **Materialised path maintenance** (`packages/db/src/topic-tree.ts`), the trickiest part of this
  phase as flagged in the plan:
  - `moveTopic` — re-parents a topic (including across subjects, FR-3.5) and/or reorders it.
    Rejects a move onto the topic itself or any of its own descendants with a dedicated
    `TOPIC_CYCLE` error code (FR-3.4, new `ErrorCode` mapped to HTTP 400 — a specific
    machine-readable code was an explicit acceptance criterion, not just a generic 400), checked
    via the materialised `path` prefix (`parent.path.startsWith(topic.path)`) before writing
    anything. Rewrites `path`/`depth` for the moved topic **and every descendant** in one
    `UnitOfWork`, in a single query (`path: { startsWith: oldPrefix }` conveniently matches the
    topic's own row too, since its own path equals the prefix — one loop handles both).
  - `deleteTopic(db, userId, topicId, mode)` — `cascade` deletes the whole subtree (topic +
    descendants, and every session/schedule/snapshot/tag-association hanging off them);
    `promote` re-parents each direct child (and its own descendants) up to the deleted topic's
    former parent, rewriting paths/depths, then deletes only the topic itself, leaving no
    orphans (FR-3.6). A same-name collision at the promoted level is checked and rejected with
    `CONFLICT` per child before any rewrite happens.
  - **A real bug found while testing this (read before touching bulk topic deletes again)**:
    `Topic.parentId` is a self-referential FK with `onDelete: Restrict` (§6.3/P1). A single
    `deleteMany` over an entire subtree's ids at once throws "Foreign key constraint violated" on
    SQLite, even though every id in the batch is being deleted together — the constraint isn't
    deferred across the one statement, so a child row can still be evaluated against an
    already-deleted parent mid-delete. **Fix: delete deepest-`depth`-first**, one `deleteMany`
    per distinct depth level (not one delete per row — still batched, just grouped by depth).
    This turned out to be a **pre-existing latent bug** in P2's `deleteUserAccount`
    (`account-deletion.ts`) too — it only surfaced now because P4 is the first phase to create
    real multi-level topic trees in a test. Fixed there as well; `subject-deletion.ts` (new)
    uses the same pattern from the start.
- **`GET /subjects/:id/tree`** (`packages/api-core/src/routes/topic-tree-view.ts` +
  `subjects.ts`): fetches the subject's full flat topic list and nests it client-side into a
  tree, attaching a `metrics` object to every node. Hard-capped at `MAX_TREE_NODES = 2000`
  (§14.4/task 7) — a subject with more topics than that returns a `BAD_REQUEST` with the actual
  count and the limit in `details`, rather than an unbounded response.
- **Own vs aggregate metrics — explicit null placeholders (FR-3.8, task 10's documented get-out
  clause)**: `placeholderTopicMetrics()` returns `{ ownScore: null, aggregateScore: null,
  ownHealthStatus: null, aggregateHealthStatus: null }` for every topic node. P3's scoring/
  roll-up functions exist and are correct, but there is no real `StudySession`/
  `CompetencySnapshot` data pipeline wired yet (that's P5's job — persisting `ReviewSchedule` and
  computing scores on write/read). Returning `null` is an honest "not yet available", matching
  `packages/core`'s own convention for a zero-session topic, rather than fabricating a `0`. P5
  replaces `placeholderTopicMetrics()`'s call sites with real computation once the pipeline
  exists — the function name and its single call site per view are deliberately easy to grep for.
- **Tags** (`packages/api-core/src/routes/tags.ts`, FR-3.9): `GET/POST /tags`, `DELETE
  /tags/:id`, `GET /tags/:id/topics` (the cross-subject filter — every topic, in any subject,
  carrying a given tag), `GET/POST/DELETE /topics/:id/tags[/:tagId]` for listing/attaching/
  detaching. The repository layer (`TagRepository`) already existed from P1; this phase added
  the missing inverse lookup (`topicsForTag`) and the HTTP surface. Tag name uniqueness
  (case-insensitive per user) gained the same pre-check pattern as subjects/topics.
- **A `withoutUndefined<T>` typing lesson** (recorded in repo memory): the existing admin-users.ts
  helper (`{ [K in keyof T]?: Exclude<T[K], undefined> }`) forces every key optional in its
  return type, which silently breaks *create*-endpoint bodies with required fields (e.g. `name`,
  `subjectId`) once reused there — `exactOptionalPropertyTypes` then rejects the call with a
  confusing "optional in source but required in target" error. Fixed locally (subjects.ts,
  topics.ts) by removing the added `?` — a homomorphic mapped type without an added modifier
  preserves each key's original required/optional-ness from the source while still stripping
  `undefined` from the value type.
- **Tests**: 3 pure unit tests for `buildTopicTree`/`placeholderTopicMetrics` (no DB), 11 new
  SQLite integration tests in `packages/db/test/topic-tree.integration.test.ts` (move across
  subjects with full path/depth verification down a 5-level chain, both cycle-rejection cases,
  cascade-delete, promote-delete leaving no orphans, subject cascade-delete, sibling-uniqueness),
  plus 21 new HTTP-level integration tests across `subjects.integration.test.ts`,
  `topics.integration.test.ts` and `tags.integration.test.ts` covering the happy path,
  validation failure (422), unauthenticated (401), and cross-user 404-not-403 for every new
  route, per the phase Definition of Done.

### Deferred / not in scope for P4

- **Own/aggregate competency metrics are `null` placeholders everywhere** — this is P4 task 10's
  explicit, documented get-out clause (P3 is merged, but the real data pipeline is P5 scope).
  `placeholderTopicMetrics()` is the one function P5 needs to replace with real
  `packages/core` calls fed by real `StudySession`/`ReviewSchedule`/`CompetencySnapshot` rows.
- **The 2000-node tree cap is implemented but not exercised by a real 2001-topic integration
  test** — creating that many rows through Prisma in a test would be slow for little marginal
  value; the length check itself is a two-line, already-typechecked comparison. Worth a
  synthetic test if this code path ever needs to change.
- **Bulk topic creation by paste (FR-3.11)** and **manual subject reordering (FR-2.6)** are both
  marked deferrable-first (**C**) in the plan's own deferred-scope list and were not built.
- PostgreSQL remains generated-but-unverified at runtime (inherited from P1 — still no Docker on
  this development machine).

### Decisions taken

- `TOPIC_CYCLE` is a first-class `ErrorCode` (mapped to HTTP 400), not a generic `BAD_REQUEST` —
  the plan's acceptance criteria specifically calls for a machine-readable code so a UI can
  distinguish "you tried to create a loop" from any other bad request.
- Materialised-path rewrites (move, cascade-delete, promote-delete) are hand-written functions
  in `packages/db` (`topic-tree.ts`, `subject-deletion.ts`) taking a `Db` and driving
  `db.unitOfWork.run(tx => ...)` directly with raw Prisma calls, rather than repository methods —
  same convention P2 established for `deleteUserAccount`: these are rare, whole-subtree,
  cross-aggregate operations, not per-aggregate CRUD.
- Bulk topic deletes always go deepest-depth-first, never a single flat `deleteMany` over an
  arbitrary id list — see the FK bug writeup above. Applied uniformly to `topic-tree.ts`,
  `subject-deletion.ts`, and retrofitted onto P2's `account-deletion.ts`.

### Handover to P5

- P5 is the first real consumer of `placeholderTopicMetrics()`'s replacement: persisting
  `ReviewSchedule`/`CompetencySnapshot` on session write, then feeding real rows through
  `packages/core`'s `computeCompetencyScore`/`computeRollupScore`/`computeHealthStatus` to
  populate `ownScore`/`aggregateScore`/`ownHealthStatus`/`aggregateHealthStatus` in
  `packages/api-core/src/routes/topic-tree-view.ts` and anywhere else that calls it.
- `moveTopic`/`deleteTopic`'s deepest-depth-first delete pattern is the template to reuse for any
  future bulk operation over a topic subtree — do not reintroduce a single flat `deleteMany`
  across a whole subtree's ids.
- Topic/Subject/Tag repositories and routes are the shape P5's session/schedule/snapshot
  endpoints should follow: pre-check uniqueness in the repository, `withoutUndefined` (the fixed,
  homomorphic version) at the route layer for PATCH-style partial bodies, cross-user 404 tests
  for every new route.

## P5 — Study Sessions, Scoring & Scheduling Integration

**Status:** Complete (SQLite path verified; PostgreSQL/D1 inherit their existing "not yet
runtime-tested here"/P11 status; `npm run test:cf` still green).

### What shipped

- **`packages/db/src/scheduling.ts`** — the phase's central piece. `resolveAlgorithm(topicOverride,
  subjectDefault, userDefault)` is the one function every caller uses for FR-5.3's topic → subject
  → user resolution order. `recalculateTopicSchedule(db, userId, topicId, { asOfDate,
  triggeredBySessionId? })` is called inside the same `UnitOfWork` as every `StudySession`
  create/update/delete (and every topic algorithm change): it loads the topic's **full** session
  history, replays it chronologically through `packages/core`'s `replaySchedule` using the
  resolved algorithm, upserts (or deletes, if no sessions remain) the topic's `ReviewSchedule`,
  and records a new `CompetencySnapshot` — never a fabricated one when there are zero sessions
  (`computeCompetencyScore`'s own `null` convention, §7.2). `isSuspended` is deliberately left
  untouched by this recalculation — it's a user preference (FR-5.10), not scheduler-derived
  state. `applyScheduleOverride(db, userId, topicId, override, asOfDate)` handles the three
  session-history-independent overrides (FR-5.6/5.10: explicit next-review date, snooze by *n*
  days, suspend/unsuspend) directly, creating a `ReviewSchedule` row with the resolved algorithm
  if the topic has never been studied.
- **`packages/db/src/topic-metrics.ts`** — the P4 handover's real replacement for
  `placeholderTopicMetrics()`. `computeSubjectTopicMetrics(db, userId, subjectId, topics,
  asOfDate)` computes own + aggregate score/health for every topic in one subject in **two** bulk
  queries (new `StudySessionRepository.listBySubject`/`ReviewScheduleRepository.listBySubject`
  methods) rather than a pair of queries per topic — deliberately, since the tree endpoint is
  capped at 2,000 nodes (P4) but shouldn't need 4,000 round trips to score. Own score/health come
  straight from `packages/core`'s `computeCompetencyScore`/`computeHealthStatus`; aggregate score
  is `computeRollupScore` over a topic's materialised-path descendants (§7.3, the same
  `path.startsWith(prefix)` technique `topic-tree.ts` uses for move/delete); aggregate health is
  the most severe status among that same descendant set (a small local severity ranking — not a
  `packages/core` export, since it's specific to "which of several already-computed statuses wins"
  rather than a scoring rule). `computeTopicMetrics(db, userId, topicId, asOfDate)` is the
  single-topic convenience wrapper P4's single-topic routes needed. **Scores are always computed
  live, as of `asOfDate`** (§7.6 "score-on-read") — never read back from the last
  `CompetencySnapshot`, since the recency component keeps decaying even between sessions;
  snapshots exist purely for the P9 retention-curve/history use case.
- **Real metrics wired everywhere `placeholderTopicMetrics()` used to be called**:
  `packages/api-core/src/routes/topic-tree-view.ts`'s `buildTopicTree` now takes a caller-supplied
  `metricsByTopicId` map (falling back to the placeholder only for a topic missing from the map —
  defensive, shouldn't happen in practice) instead of hard-coding the placeholder internally;
  `subjects.ts`'s `/subjects/:id/tree` and every one of `topics.ts`'s single/list topic routes now
  call `computeSubjectTopicMetrics`/`computeTopicMetrics` before building their response.
- **Study session routes** (`packages/api-core/src/routes/sessions.ts`, FR-4.*): `GET/POST
  /topics/:id/sessions`, `PATCH/DELETE /sessions/:id`, `POST /topics/:id/sessions/preview`
  (FR-5.4 — returns the grade `computeGrade` would produce, without persisting anything),
  `GET /topics/:id/history` (date-range-filterable `CompetencySnapshot` listing, `from`/`to` query
  params), `POST /topics/:id/schedule/override` (FR-5.6/5.10, a Zod discriminated union over
  `setNextReviewOn`/`snooze`/`suspend`). Every session create/update/delete calls
  `recalculateTopicSchedule` inside the same request; `studiedOn` defaults to the user's current
  day (`startOfUserDay(now, tz, dayStartHour)`) when omitted from the request body, and is
  rejected with `VALIDATION_FAILED` if it resolves later than that "today" (FR-4.1/FR-5.9 — a
  session logged at 01:00 local with `dayStartHour = 4` still belongs to yesterday).
- **A real, pre-existing gap fixed along the way**: `StudySessionRepository`'s `computeAccuracy`
  (P1-authored) only ever validated `questionsAttempted > 0` — it never checked
  `questionsCorrect <= questionsAttempted`, so a corrupt session (e.g. a partial `PATCH` where
  only `questionsCorrect` changes) could have silently produced an accuracy above 100%. Fixed as
  defence-in-depth at the repository layer (`packages/db/src/repositories/study-session.ts`),
  independent of the new Zod cross-field `.refine()` in `packages/shared/src/sessions.ts` (which
  only catches the case where both fields are supplied together in one request).
- **Request schemas** (`packages/shared/src/sessions.ts`, `schedule.ts`) and a new
  `dateOnlySchema` (`packages/shared/src/date.ts`) — `YYYY-MM-DD` on the wire, parsed straight to
  the UTC-midnight storage representation via `.transform()`. This was the first schema in the
  codebase with differing Zod input/output types, which exposed a real bug in
  `packages/api-core/src/validation.ts`'s `parseJsonBody<T>(c, schema: ZodType<T>)`: constraining
  to `ZodType<T>` alone forces `Input === Output === T`, so any `.transform()`-based schema failed
  to typecheck. Fixed by making it generic over the schema itself
  (`parseJsonBody<S extends ZodType>(c, schema: S): Promise<z.infer<S>>`) — worth remembering for
  any future request schema that transforms its input.
- **`packages/db` and `packages/api-core` now depend on `packages/core`** (previously only
  `packages/db` held Prisma/data-shape concerns and `packages/api-core` composed `db` + `shared`)
  — necessary for `recalculateTopicSchedule`/`computeSubjectTopicMetrics` (in `db`) and the grade
  preview endpoint (in `api-core`) to call `packages/core`'s pure functions. No cycle: `core` still
  depends on nothing but `shared`. Confirmed this doesn't affect Worker bundle size in any
  meaningful way (`npm run test:cf` and a dry-run `wrangler deploy` both still green; Worker
  bundle is ~85.85 KiB gzip, well under the 3 MB budget) since `packages/core` has zero runtime
  dependencies beyond `ts-fsrs`, which was already in the Worker's graph via nothing — this is its
  first inclusion, and it's small.
- **Tests**: 13 new integration tests in `packages/api-core/src/routes/sessions.integration.test.ts`
  covering the full CRUD cycle (including that deleting a topic's last session removes its
  `ReviewSchedule` rather than leaving stale state), validation failures (422 for
  `questionsCorrect > questionsAttempted`, for a future `studiedOn`), the preview endpoint,
  cross-user 404 (not 403) across every new route, all three schedule-override actions (including
  suspending a never-studied topic with no existing `ReviewSchedule` row), date-range-filtered
  history, and — matching the phase's own acceptance criteria verbatim — a back-dated
  out-of-order session producing the same schedule as logging in chronological order, a 5-session
  create-then-delete-the-2nd sequence whose resulting schedule and latest snapshot are verified
  against an independently-computed fresh replay/score, two topics with identical sessions but
  different algorithms producing different (and independently-verified-correct) next-review
  dates, and a topic algorithm change reporting `scheduleChanged: true` via `PATCH /topics/:id`.

### Deferred / not in scope for P5

- **FSRS interval ceiling (open question Q3)** — still `ts-fsrs`'s own default, as flagged at P3;
  this phase didn't have a reason to revisit it (no product-specific requirement forced the
  question). Still open for whoever needs it.
- **Progress status (`computeProgressStatus`) is not wired into `TopicMetricsView`** —
  `TopicMetricsView`'s shape (fixed at P4) only has `ownScore`/`aggregateScore`/
  `ownHealthStatus`/`aggregateHealthStatus`, no progress-status field, so this phase computed and
  wired exactly those four rather than expanding the view's shape speculatively. Worth adding
  once a P7/P8/P9 screen actually needs to display it.
- **No dedicated "read the current schedule" GET endpoint** — the schedule is always returned as
  part of a session write's or an override's response body (`{ schedule }`); there's no standalone
  `GET /topics/:id/schedule`. Nothing in the plan's P5 task list calls for one; add it if a P6+ UI
  screen needs to fetch a topic's schedule independent of a write.
- **Daily review maximum (FR-5.11)** — explicitly marked deferrable-first (**C**) in the plan's
  own deferred-scope list; not built.
- **Weight validation (FR-8.2's "weights sum to 1.0")** is still only enforced by
  `packages/core`'s `validateScoringWeights`, which nothing calls yet — `UserSettings` weights are
  trusted as stored. P10 owns the settings UI/validation task; `recalculateTopicSchedule`/
  `computeSubjectTopicMetrics` both read `settings.weight*` directly without calling it.
- PostgreSQL/D1 remain in their inherited states (generated-but-unverified at runtime for
  PostgreSQL; repositories throw a clear "not implemented until P11" for D1) — this phase didn't
  change either.

### Decisions taken

- **Recalculation always replays the full history from scratch** rather than patching
  incrementally — the same principle P3 established for `replaySchedule` itself, now applied at
  the persistence layer: it's what makes a back-dated or edited/deleted session produce a
  provably-correct result without a separate "incremental update" code path to keep in sync.
- **A session write always records a new snapshot** (when there are sessions to score at all) —
  `CompetencySnapshot` is treated as an append-only event log of "the score as of every write",
  not a single current-value cache. Current-value reads (topic views, tree views) never consult
  it; they always call `computeCompetencyScore` live (§7.6).
- **Cross-aggregate scheduling/scoring logic lives in `packages/db`**, not `packages/api-core` —
  consistent with P4's `topic-tree.ts`/`subject-deletion.ts` convention: these are rare,
  whole-topic, cross-aggregate reads/writes built directly on `UnitOfWork`/raw Prisma calls, not
  per-aggregate repository CRUD. `packages/api-core`'s route handlers stay thin: parse the
  request, call one `db`/`core` function, shape the response.
- **`isSuspended` is orthogonal to both recalculation and the scheduler's own state** — it's the
  one `ReviewSchedule` column neither `ScheduleState` (packages/core) nor
  `recalculateTopicSchedule`'s upsert touches; only `applyScheduleOverride` sets it.

### Handover to P6+

- `packages/api-core`'s public route surface P6 (web shell) and P7 (subjects/topics UI) will
  consume: `GET/POST /topics/:id/sessions`, `PATCH/DELETE /sessions/:id`,
  `POST /topics/:id/sessions/preview`, `GET /topics/:id/history`,
  `POST /topics/:id/schedule/override`. Every topic/subject response now carries **real**
  `ownScore`/`aggregateScore`/`ownHealthStatus`/`aggregateHealthStatus` — P7's topic
  cards/detail pages and P9's analytics screens are the first real consumers of live (not
  placeholder) data.
- P8 (review queue) will want a bulk "topics due today/overdue" query — nothing in P5 built one,
  since nothing in P5's task list called for it; `computeSubjectTopicMetrics`'s per-topic
  `overdueDays` calculation is the piece to reuse/extract when P8 needs to rank a queue.
- P9 (analytics) is the intended consumer of `GET /topics/:id/history`'s snapshot series for the
  retention curve (FR-7.7) and of the Topic Health View's "review trend" (FR-7.6, comparing the
  last two snapshots) — both read directly from `CompetencySnapshot`, never recomputed live,
  unlike current-score display.
- If a future phase needs `packages/core` functionality from `packages/api-core` again (it now
  will, for the first time, going forward), remember P1's Node/Workers-bundling lesson still
  applies transitively: `packages/core` itself is safe (zero Node deps), but anything *new* added
  to `packages/core` must stay that way, since both `apps/api` and `apps/worker` now pull it in
  through `db`/`api-core`.




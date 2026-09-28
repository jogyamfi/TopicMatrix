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

## P6 — Web Application Shell

**Status:** Complete. Verified live end-to-end in a real browser (Node/SQLite, T1 loop) — login,
forced password change, dashboard, dark theme, and the full admin user CRUD cycle.

### What shipped

- **Vite + React 18 + React Router**, `apps/web`: a **data router**
  (`createBrowserRouter`/`createRoutesFromElements`/`RouterProvider`), not the plain
  `<BrowserRouter>` — required because `useMatches`/route `handle` (used by `Breadcrumbs`) only
  work under a data router. Every page (`login`, `change-password`, `dashboard`, `admin/users`,
  `not-found`) is `React.lazy`-loaded, each its own build chunk (verified via `npm run build -w
  apps/web`'s per-chunk output), behind one root `Suspense` boundary.
- **Tailwind + a small shadcn/ui-style primitive set** (`src/components/ui/`): button, input,
  label, card, badge, table, dialog, tabs, tooltip, popover, select, toast, skeleton — Radix
  primitives + `class-variance-authority` + the standard `cn()` (`clsx` + `tailwind-merge`)
  helper. Design tokens (`index.css`, HSL CSS variables) define light/dark palettes plus a
  dedicated **health-status palette** (`--health-strong/needs-review/at-risk/not-started`) for
  P7+ to consume via `HealthStatusBadge`. `tailwindcss-animate` was dropped (blocked by the
  corporate npm proxy, see repo memory) — the handful of animations it would have provided
  (accordion, fade) are hand-written keyframes in `tailwind.config.js` instead.
- **Typed API client** (`src/lib/api-client.ts`): `apiFetch<S extends ZodType>(path, schema,
  opts)` parses every response through a Zod schema at the boundary (`schema.safeParse`, throws
  loudly on mismatch) and implements silent-refresh-on-401-then-replay-once. New response schemas
  were added to `packages/shared/src/auth.ts` (`publicUserSchema`, `authResponseSchema`,
  `statusResponseSchema`, `adminUserViewSchema`, `adminUsersListResponseSchema`,
  `adminCreateUserResponseSchema`, `adminUpdateUserResponseSchema`) — `packages/shared` is now the
  source of truth for response shapes too, not just requests.
- **TanStack Query** (`src/lib/query-client.ts`): a `queryKeys` factory (currently just
  `admin.users()`) and one `staleTime`/`retry` default. `src/lib/invalidations.ts` is the single
  place mapping mutations → invalidated keys (`afterAdminUserCreate/Update/Delete`) — the
  convention P7+ should extend rather than calling `queryClient.invalidateQueries` ad hoc from
  inside components.
- **Auth flow**: the access token lives **only** in memory (SEC-2), in a framework-agnostic
  `authStore` module (`src/lib/auth-store.ts`, same external-store pattern used later for
  `toast-store.ts`) — never `localStorage`. `AuthProvider` (`useSyncExternalStore`) bootstraps a
  session from the HttpOnly refresh cookie on mount. Login → forced password-change (blocks
  navigation elsewhere while `mustChangePassword` is true, mirroring the server's
  `requirePasswordChanged` middleware) → logout, all live-tested in a browser.
- **Route guards** (`src/components/layout/route-guards.tsx`): `ProtectedRoute` (redirect
  unauthenticated → `/login`, preserving `state.from`), `RequirePasswordChanged`, `AdminRoute`,
  `PublicOnlyRoute` (keeps an authenticated user off `/login`).
- **App shell** (`src/components/layout/app-shell.tsx`): responsive nav — a static sidebar on
  desktop (`sidebar.tsx`), a Radix-Dialog-based drawer on mobile (`mobile-nav.tsx`, gets
  focus-trap/Escape-to-close for free) — a header slot (breadcrumbs via route `handle` +
  `useMatches`, theme toggle, user menu), a toast host, and a global `ErrorBoundary` wrapping
  every routed page so one broken screen doesn't take down the shell.
- **Theming** (`src/context/theme-context.tsx`): light/dark/system, persisted to `localStorage`,
  reacts to OS-level `prefers-color-scheme` changes while `theme === 'system'`. No flash of wrong
  theme on load — `index.html` has an inline pre-paint script applying the resolved theme class
  before React mounts; `ThemeProvider` keeps it in sync afterward.
- **Accessibility baseline (NF-4)**: a skip link (`.skip-link`, visually hidden until focused), a
  visible `:focus-visible` ring on every interactive element (never suppressed), focus moved to
  `#main-content` on every route change (`use-route-focus.ts`), an `aria-live` toast region (built
  into Radix Toast's viewport), and **`HealthStatusBadge`** (`src/components/health-status-badge.tsx`)
  — established now, for P7+ to reuse: every health status is an icon + text pairing, never
  colour alone.
- **Admin user management screens** (`src/pages/admin/`): list (table, real data via
  `GET /admin/users`), create (dialog → shows the generated temporary password exactly once, with
  a copy-to-clipboard button), disable/enable (PATCH `isActive`), delete (typed-display-name
  confirmation gates the destructive button, per FR-1.8). All three mutations wired through
  `invalidations.ts`; the list re-renders immediately after each.
- **Loading/empty states**: `Skeleton` (ui primitive) and `EmptyState` (`src/components/
  empty-state.tsx`) used consistently — the users table shows skeleton rows while loading and an
  `EmptyState` if the list is genuinely empty; the dashboard placeholder uses the same
  `EmptyState` for "no subjects yet".

### Two real bugs found and fixed while browser-testing this (read before touching auth/routing again)

1. **`useMatches` needs a data router.** `Breadcrumbs` (via route `handle`) initially crashed
   every render with "useMatches must be used within a data router" because `App.tsx` used plain
   `<BrowserRouter><Routes>...`. Fixed by switching to `createBrowserRouter`/`RouterProvider` with
   a pathless root layout route (`RootLayout`) providing the one `Suspense` boundary every lazy
   page needs.
2. **A genuine redirect-loop bug, not a network race** (worth remembering the debugging path,
   not just the fix): after changing password, `ChangePasswordPage` calls `authStore.reset()`
   then `navigate('/login', { replace: true })`. But `authStore.reset()` also triggers a
   re-render of the *still-mounted* `ProtectedRoute` (now unauthenticated), which independently
   renders its own `<Navigate to="/login" replace state={{ from: location }} />` — where
   `location` at that instant is `/change-password`. Both redirects target `/login`, and
   whichever's `history.replaceState` call lands last wins the entry's `state`. The next explicit
   login then read `state.from.pathname === '/change-password'` and navigated straight back there
   even though the fresh login response's `mustChangePassword` was correctly `false` (verified
   directly against the API with `curl`/`Invoke-WebRequest`, bypassing the frontend entirely, to
   rule out a backend bug first). **Fix**: `LoginPage` now refuses to treat `/login` or
   `/change-password` themselves as a valid `state.from` redirect target — auth-flow pages are
   never a meaningful "return to" destination. (An unrelated epoch-guard was added to
   `auth-store.ts`'s `refresh()` first, on a *wrong* initial hypothesis that a slow mount-time
   bootstrap refresh was clobbering a fresher login; that guard is harmless and worth keeping as
   real defence-in-depth for that separate, still-plausible race, but it was **not** what caused
   this particular bug — the redirect-loop fix above was.)
- **Vite dev-server dependency pre-bundling needed the same `esbuild` target fix as the
  production build** — P0's `build.target: 'es2022'` only covers the production build step; the
  dev server's separate dependency optimizer (its own `esbuild` pass over `node_modules`, used to
  pre-bundle things like Radix packages) has its own target and broke on the first `npm run dev`
  with "Transforming destructuring ... is not supported yet" for every `@radix-ui/*` package.
  Fixed with `optimizeDeps.esbuildOptions.target: 'es2022'` alongside the existing `build.target`
  in `apps/web/vite.config.ts`. Recorded in repo memory since this is exactly the kind of
  machine-specific esbuild-override fallout the P0 note already tracks.

### Deferred / not in scope for P6

- **Real subject/topic data on the dashboard** — deliberately a placeholder `EmptyState`
  ("Subjects and topics arrive in the next phase of TopicMatrix"); P7 is the first real consumer.
- **`tailwindcss-animate`** — blocked by the corporate npm proxy (403 on that exact package);
  substituted with three hand-written keyframes (`accordion-down/up`, `fade-in`) in
  `tailwind.config.js`. Revisit if a future component needs a animation the hand-written set
  doesn't cover.
- PostgreSQL/D1 remain in their inherited states — this phase didn't touch persistence.
- No E2E (Playwright) suite yet — explicitly a P10 task.

### Decisions taken

- **`createBrowserRouter` (data router), not `<BrowserRouter>`** — required for `useMatches`/route
  `handle`-based breadcrumbs; every future route addition should go through
  `createRoutesFromElements` in `App.tsx`, not a parallel `<Routes>` tree.
- **Auth token and toast state both live in small framework-agnostic external stores**
  (`auth-store.ts`, `toast-store.ts`), not React Context alone — lets `apiFetch`, mutation
  `onError` handlers, and other non-component code call `authStore.refresh()`/`toast()` directly
  without needing a hook.
- **Response schemas belong in `packages/shared`, alongside request schemas** — extends the
  existing "Zod schemas are the single source of truth" convention (P0 task 2) from requests to
  responses; the typed API client's `schema.safeParse` on every call is what makes a future
  backend/frontend shape drift a loud build/runtime error instead of a silent `undefined`.
- **Auth-flow pages (`/login`, `/change-password`) are never a valid `state.from` redirect
  target** — see bug #2 above; a general rule worth keeping for any future auth-adjacent route.

### Handover to P7+

- `NAV_ITEMS`/`navItemsFor(role)` (`src/components/layout/nav-items.ts`) is where P7 adds
  Subjects/Topics navigation entries.
- `HealthStatusBadge`, `EmptyState`, `Skeleton`, the `Table`/`Card`/`Dialog`/`Tabs` primitives, and
  the `queryKeys`/`invalidations` conventions are all ready for P7's subject/topic screens to
  reuse directly — no new pattern should be needed for basic CRUD list/detail/dialog screens.
- The typed API client (`apiFetch`) and the "add response schemas to `packages/shared`" convention
  is how every future endpoint should be consumed — see `admin/users-page.tsx` and its two dialogs
  for the reference shape (query + mutation + invalidation + Zod-parsed response).
- If a future phase adds another page that can redirect back to itself post-login (unlikely, but
  worth checking), extend `NON_REDIRECT_TARGETS` in `login-page.tsx` rather than special-casing it
  elsewhere.

## P7 — Subjects & Topics UI

**Status:** Complete. Verified via `npm run typecheck`, `npm run lint`, `npm test` (132 passed),
`npm run test:integration` (84 passed), `npm run test:cf` (5 passed, Worker bundle unaffected —
89.2 KiB gzip), and a production `npm run build -w apps/web` (each new page its own chunk, per
P6's code-splitting convention).

### What shipped

- **Response schemas added to `packages/shared`** for every P4/P5 endpoint that previously had
  none (subjects, topics, tags, sessions, schedule) — extends P6's "response shapes live in
  `packages/shared`, parsed at the API-client boundary" convention from auth/admin-users to
  everything P7 needed. Notably `topicTreeNodeSchema` (`packages/shared/src/topics.ts`) is a
  genuinely **recursive** Zod schema (`z.lazy` + an explicit `z.ZodType<TopicTreeNodeView>`
  annotation, since Zod can't infer a self-referential schema's type on its own) — the first one
  in the codebase.
- **Two small, justified backend additions**, both explicitly flagged as "add when a real
  consumer needs it" in earlier phases' handover notes:
  - `GET /topics/:id/schedule` (`packages/api-core/src/routes/sessions.ts`) — P5 deferred a
    standalone schedule read pending a real consumer; the topic detail page's "next review" card
    is the first one. Reuses the existing `db.reviewSchedules.find` and `toScheduleView`.
  - `packages/db/src/subject-summary.ts`'s `computeSubjectSummary` — per-subject topic count,
    aggregate competency, due-today count and last-activity date for the subject cards (FR-2.5).
    `aggregateScore` is the **unweighted mean of the subject's root topics' `aggregateScore`**
    (each root's own aggregate already covers its whole descendant subtree, and roots partition
    every topic via the materialised path) — deliberately reuses `computeSubjectTopicMetrics`
    rather than re-deriving `packages/core`'s roll-up math a second time. Wired into `GET
    /subjects`'s list response (`subjectListItemSchema` = `subjectViewSchema` + `summary`).
- **Subject list** (`pages/subjects/subjects-page.tsx`): cards with topic count/aggregate
  score/due-today/last-activity, a colour swatch + emoji icon picker (`subject-appearance.ts` —
  a small curated palette, not a full colour/emoji-picker dependency), create/edit
  (`subject-dialog.tsx`) and typed-name-confirmation delete (`delete-subject-dialog.tsx`, same
  pattern as P2's admin-user delete).
- **Topic tree view** (`pages/subjects/subject-tree-page.tsx` + `topic-tree-node.tsx`): fully
  recursive, expand/collapse state persisted to `localStorage` per subject
  (`topictree:collapsed:<subjectId>`), inline rename (click pencil → input, Enter/Escape/blur),
  inline "add child"/"add root topic" via `create-topic-dialog.tsx`. Every row's action set (log
  session, add sub-topic, rename, move, delete, reorder up/down) is **always visible**, not
  hover-revealed — a deliberate accessibility choice (hover-only reveal is a known keyboard-a11y
  antipattern; see NF-4). Depth warning (FR-3.2) is a non-blocking amber icon + tooltip at
  `depth >= 6`.
- **Drag-and-drop + keyboard alternative (FR-3.4/3.5, NF-4, task 3)** — a deliberate scope
  decision, not the originally-listed `dnd-kit`:
  - **Re-parenting** uses native HTML5 drag-and-drop (`draggable`, `dragstart`/`dragover`/`drop`
    events) — dropping a row onto another row re-parents it as that node's child; dropping in the
    tree's empty background re-parents to the subject's top level. No new dependency needed.
  - **Reordering** among siblings uses explicit "move up"/"move down" icon buttons (swap
    `sortOrder` with the adjacent sibling via two `POST /topics/:id/move` calls) rather than
    drag-based reordering — avoids the fractional-indexing problem of computing a new `sortOrder`
    between two existing integers when dropped mid-list, and is keyboard-operable by construction.
  - **`move-topic-dialog.tsx`** is the required keyboard-accessible alternative to drag-and-drop
    (NF-4) — two plain `Select`s (target subject, target parent, indented by depth), supporting
    cross-subject moves (FR-3.5) that dragging within one subject's tree view can't reach anyway.
    Excludes the dragged topic and its own descendants from the parent list client-side (the
    server's `TOPIC_CYCLE` check is still the source of truth).
- **Delete topic dialog** (`delete-topic-dialog.tsx`, FR-3.6): cascade vs promote, with the
  descendant count computed client-side from the already-loaded tree (`countDescendants`) —
  exact affected **session** counts are not shown (would need either a new endpoint or an
  N-topic fan-out of queries just for a delete confirmation dialog; deferred, see below).
- **Log Session dialog** (`pages/topics/log-session-dialog.tsx`, FR-4.5/FR-5.4, G2 — under 20
  seconds): date defaults to today, questions-attempted auto-focused, live accuracy display,
  `ConfidenceScale` (`components/confidence-scale.tsx`, the labelled 1–5 control, FR-4.5's exact
  wording), a live grade preview (`POST /topics/:id/sessions/preview`, refetched via a
  `useQuery` keyed on the three inputs — cheap enough locally that no manual debounce was
  needed) with a tappable override, notes collapsed behind a "+ Add notes" toggle, submit on
  Enter. Reused unmodified from both the topic tree row's "Log" action and the topic detail page.
- **Session history table** (`pages/topics/session-history-table.tsx`, FR-4.6): sortable
  (date/questions/accuracy/confidence, click-to-toggle direction) and paginated (10/page),
  inline edit (`edit-session-dialog.tsx`) and delete (`delete-session-dialog.tsx`), both
  triggering `invalidations.afterSessionWrite` (invalidates the whole subject tree, since a
  session write changes the topic's own score **and** every ancestor's roll-up).
- **Topic detail page** (`pages/topics/topic-detail-page.tsx`, task 8): name/notes with an edit
  dialog (`edit-topic-dialog.tsx`, also handles algorithm override — warns via toast when
  `scheduleChanged` comes back `true`), own vs aggregate competency cards, a "next review" card
  (algorithm + date, from the new schedule endpoint), a pause/resume-reviews button (the schedule
  override `suspend` action, FR-5.10), inline tag attach/detach/create, log-session entry point,
  and the session history table.
- **Tags** (`pages/tags/tags-page.tsx`, FR-3.9, task 9): create/delete, and a cross-subject
  filter — selecting a tag calls `GET /tags/:id/topics` and lists every topic carrying it across
  every subject, each linking straight through to its topic detail page.
- New shared UI pieces: `components/ui/textarea.tsx` (P6 had no textarea primitive yet),
  `components/confidence-scale.tsx`.
- `queryKeys`/`invalidations` (`lib/query-client.ts`/`lib/invalidations.ts`) extended per P6's
  established convention — subject/topic/session/tag writes all invalidate the *whole subject
  tree* (`queryKeys.subjects.tree`) rather than trying to track exactly which nodes' roll-ups
  changed, since a session or topic write can change scores anywhere up the ancestor chain.

### Deferred / not in scope for P7

- **Tree virtualisation beyond ~200 visible nodes** (task 2's explicit ask) — no virtualisation
  library (e.g. `react-window`) is in `apps/web`'s dependencies, and adding one carries the same
  corporate-proxy install risk documented for other packages in repo memory. Given the acceptance
  criteria only require a 3–5 level tree to work smoothly, this was deferred rather than adding a
  new dependency speculatively. Revisit if a real large-tree performance problem is observed.
- **Exact session counts in the delete-topic dialog** — only the descendant *topic* count is
  shown (computed client-side from the loaded tree); showing exact session counts too would need
  either a new bulk-count endpoint or an expensive per-topic fan-out purely for a confirmation
  dialog. The cascade-vs-promote description is still accurate about what's affected, just not
  numerically precise on sessions.
- **A true global "log session" keyboard shortcut reachable from anywhere in the app** (task 6's
  literal wording) — implemented instead as a "Log" action on every topic tree row and on the
  topic detail page, which covers the G2 <20s/<6-interaction acceptance criterion for the actual
  logging flow, but there is no single global hotkey that opens a topic picker from any screen.
  Worth adding if usage shows this matters in practice.
- **Manual subject reordering (FR-2.6)** and **bulk topic creation by paste (FR-3.11)** — both
  marked deferrable-first (**C**) in the plan's own deferred-scope list; not built.
- The **Topic.isSuspended** field (a P4-era `PATCH /topics/:id` field, separate from
  `ReviewSchedule.isSuspended`) is editable via `edit-topic-dialog.tsx`'s update body but has no
  dedicated UI control exposed — only the schedule-level "Pause/Resume reviews" button (which
  toggles `ReviewSchedule.isSuspended` via the schedule-override endpoint) is surfaced
  prominently. The two fields' exact intended semantic difference was never fully disambiguated
  in any prior phase's notes; flagged here rather than guessing at new behaviour.
- PostgreSQL/D1 remain in their inherited states (generated-but-unverified at runtime for
  PostgreSQL; D1 repositories are P11 scope) — this phase didn't touch persistence internals
  beyond the two additions above, both of which are provider-agnostic (`Db` interface calls).

### Decisions taken

- **Native HTML5 drag-and-drop instead of `dnd-kit`** for topic re-parenting, with sibling
  reordering done via explicit up/down buttons instead of drag-based reordering — see the "What
  shipped" section above for the full rationale (avoids a new dependency, sidesteps
  fractional-indexing, and is keyboard-operable by construction rather than needing a parallel
  keyboard implementation).
- **Tree action buttons are always visible, never hover-revealed** — a deliberate NF-4 choice;
  hover-only reveal of interactive controls is a keyboard-accessibility antipattern.
- **Two small backend additions this phase** (`GET /topics/:id/schedule`,
  `computeSubjectSummary`) rather than working around their absence in the frontend — both were
  explicitly flagged in earlier phases' handover notes as "add when a real UI screen needs it",
  and P7 is that screen. Both are thin, provider-agnostic reads with no new business logic.
- **`invalidations.afterSessionWrite`/`afterTopicWrite` invalidate the whole subject's tree
  query**, not a single topic's cache entry — correct given roll-up scores can change anywhere up
  the ancestor chain, at the cost of slightly more refetching than a more surgical invalidation
  would need. Revisit only if this proves to be a real performance problem.

### Handover to P8+

- The review queue (P8) will want a bulk "topics due today/overdow" query across *all* subjects —
  P7's subject-card `dueTodayCount` and topic-detail's schedule read are both single-subject/
  single-topic; P5's handover note already flagged `computeSubjectTopicMetrics`'s per-topic
  `overdueDays` calculation as the piece to extract for a real cross-subject queue.
- `LogSessionDialog`/`EditSessionDialog`/`SessionHistoryTable` are ready to be reused by P8's
  launcher (log/skip/snooze one topic at a time) without modification — they only need a
  `{ id, subjectId, name }` topic reference.
- `GET /topics/:id/schedule` and `computeSubjectSummary` are the two new provider-agnostic reads
  this phase added; P9's analytics screens and P8's queue are natural next consumers of similar
  small, targeted reads rather than growing the existing list/tree endpoints further.

## P8 — Review Queue & Study Session Launcher

**Status:** Complete. Verified via `npm run typecheck`, `npm run lint`, `npm test` (132 passed),
`npm run test:integration` (95 passed, including 11 new review-route tests), `npm run test:cf` (5
passed, Worker suite unaffected), and a production `npm run build -w apps/web` (each new page its
own chunk).

### What shipped

- **Cross-subject bulk reads** (`packages/db/src/repositories/{topic,study-session,review-schedule}.ts`):
  `listAllForUser(userId)` on each, added specifically so the queue/launcher don't do an N+1 scan
  per subject — the piece the P7 handover note flagged as needed. `computeEligibleTopicItems`
  (`packages/db/src/review-queue.ts`) is the single bulk-computation shared by both endpoints
  below; it mirrors `topic-metrics.ts`'s per-subject loop but works across every subject at once
  and skips the aggregate roll-up (the queue has no use for it).
- **`GET /review/queue`** (FR-7.1) — `computeReviewQueue` buckets eligible topics into
  Overdue / Due today / Due in the next 7 days, sorted overdue-days-descending then
  competency-ascending. A topic is eligible if it has a `ReviewSchedule` row (see below) and
  neither the topic nor its schedule is suspended, and its subject isn't archived.
- **`POST /review/start`** (FR-6.1, FR-6.2, FR-6.4) — `buildReviewSession` builds an ordered,
  capped list for the launcher. Primary scope is one of `subject` / `topicSubtree` / `dueToday` /
  `weakest`; secondary filters (`tagId`, `healthStatus`, `notReviewedInDays`, `minScore`,
  `maxScore`) narrow any of them further. Caps: `maxItems` slices the list; `targetMinutes`
  greedily keeps items while the running total (estimated from the user's own average logged
  `durationMinutes`, defaulting to 5 min/item with no history) stays under the target, always
  keeping at least one item.
- **Decision — a schedule-existence gate, not a "has sessions" gate**: eligibility for both
  endpoints is "has a `ReviewSchedule` row", not "has ever been studied". These aren't always the
  same thing — FR-5.6/FR-5.10 let a next-review date or suspended flag be set directly on a
  never-studied topic (confirmed against `applyScheduleOverride`'s "creates a schedule row if the
  topic has never had one" behaviour), so such a topic can appear in the queue with a `null`
  score. A topic with genuinely no schedule at all (never studied, never overridden) has nothing
  to review yet and is correctly excluded. Weakest-first sorting treats a `null` score as lowest
  priority (sorts last), not as "weakest" — an unknown topic isn't necessarily weak.
- **`accuracyTrend` computed server-side**, from the two most recent sessions' accuracy (not the
  `CompetencySnapshot` history P9 owns) — avoids the launcher needing a second per-item fetch to
  satisfy FR-6.3's "last score, accuracy trend, next-due date" for the item currently on screen.
- **Review Queue UI** (`pages/review/review-queue-section.tsx`) — shared by the dashboard
  (`compact`, capped to 5 items with a "View all N due" link) and the standalone `/review` page
  (`review-queue-page.tsx`, full buckets). Per-item quick actions: **Log** (reuses P7's
  `LogSessionDialog` unmodified except for one addition below), **Snooze** (inline `Select`,
  1/3/7 days, calls the existing `POST /topics/:id/schedule/override`), **Suspend** (same
  endpoint). No new backend needed for either quick action — both were already built in P5.
- **Launcher** (`pages/review/launcher-page.tsx` at `/review/launch`) — one topic at a time:
  name, subject, notes, health status, last score, accuracy trend, next-due date, a progress bar,
  and Log / Skip / Snooze actions. **Resumable progress (FR-6.5)** is client-side-only
  (`lib/launcher-store.ts`, `localStorage` key `topicmatrix:launcher-run`): the ordered item list
  *and* current index are persisted on every advance, so a refresh reads the same run back rather
  than re-querying `/review/start` (which could return a different order/set once anything has
  changed) — satisfies NF-15's "no server-side in-process state" by construction, per the plan's
  own explicit allowance for client-side persistence here.
- **Launch configuration dialog** (`launch-review-dialog.tsx`) — mode picker (due today /
  weakest / a specific subject) plus the secondary filters and caps, reachable from `/review`'s
  "Start review session" button. Two more entry points reuse the same dialog with a **fixed**
  scope (mode pre-set, no picker shown): "Review this subject" (subject tree page header) and
  "Review this topic" (topic detail page header, `topicSubtree` mode — topic + descendants).
- **One small, justified change to `LogSessionDialog`**: an optional `onLogged` callback, invoked
  on successful save before the dialog closes. Every existing caller (topic tree row, topic
  detail page) is unaffected (prop omitted); the launcher uses it to advance to the next item.
- Nav: added a "Review" sidebar/mobile-nav link (`components/layout/nav-items.ts`) and a new
  `queryKeys.review.queue()` key, invalidated by `invalidations.afterSessionWrite` (a session
  write can move a topic in or out of the queue) and directly by the queue's own quick actions.

### Deferred / not in scope for P8

- **FR-5.11 (daily maximum with lowest-priority deferral)** — the plan explicitly lists this as
  Could-have with permission to defer; not built. There's no per-user "daily maximum reviewed"
  setting in the schema yet either. Revisit at P8-follow-up or P10 (settings) if wanted.
- **A generic topic picker for `topicSubtree` mode in the launch dialog** — the dialog's own mode
  picker only offers due-today/weakest/subject; `topicSubtree` is only reachable via the fixed-
  scope entry point on the topic detail page (there's no topic search/autocomplete endpoint to
  build a generic picker against). Functionally complete (FR-6.1 is satisfied), just not
  reachable from every possible starting point.
- **Launcher item data is a point-in-time snapshot from `POST /review/start`**, not re-fetched
  live per item — deliberate (keeps the launcher simple and resumable without a network
  dependency), but means a score/trend shown mid-run won't reflect a session logged for that same
  topic through some other tab in the meantime. Edge case, not expected to matter in practice.
- Tree/list virtualisation, PostgreSQL/D1 runtime verification: unchanged from P7's own deferred
  list — this phase didn't touch either area.

### Decisions taken

- **Eligibility = "has a `ReviewSchedule` row"**, not "has sessions" — see above. Documented here
  because it's easy to assume the two are equivalent (P5's FR-5.1 comment about lazy creation on
  first session reads that way) when FR-5.6/FR-5.10 are a second, independent path to the same
  row.
- **`buildReviewSession`'s `targetMinutes` cap estimates per-item time from the user's own
  historical average `durationMinutes`** (falling back to a flat 5 minutes with no history)
  rather than trying to predict per-topic review time — there's no other signal available, and
  getting this exactly right isn't what FR-6.4 (a Should-have) is testing for.
- **Client-side-only resumable launcher state** (`localStorage`, no server persistence) — the
  plan explicitly allows this for FR-6.5, and it sidesteps NF-15 entirely rather than needing a
  new "in-progress session" server concept just for a refresh to survive.

### Handover to P9+

- `packages/db/src/review-queue.ts`'s `computeEligibleTopicItems` (own score, health, schedule,
  accuracy trend, per topic, in one bulk pass) is now the second cross-subject bulk-read pattern
  after `topic-metrics.ts`'s per-subject one — P9's Topic Health View / heatmap need a very
  similar per-topic-across-all-subjects computation and should extend or reuse this rather than
  writing a third variant.
- The accuracy-trend calculation here (comparing the two most recent sessions' raw accuracy) is
  deliberately simpler than what P9's "review trend ▲▼▬" (FR-7.6, from the last two competency
  *snapshots*) needs — don't conflate the two; they answer different questions from different
  data sources.
- `queryKeys.review.queue()` / `invalidations.afterSessionWrite` now also cover the review queue —
  any future mutation that can change a topic's due date or suspension state should invalidate it
  too, the same way session writes and the queue's own quick actions already do.
- If P9 needs virtualisation for large lists (Topic Health View, FR-7.6, is likely to have more
  rows than a topic tree), evaluate a virtualisation library then rather than retrofitting it
  into the P7 tree — the corporate-proxy install risk noted above applies equally there.

## P9 — Dashboard & Analytics

**Status:** Complete. Verified via `npm run typecheck`, `npm run lint`, `npm test` (140 passed,
including 8 new `computeStreak` unit tests), `npm run test:integration` (108 passed, including 13
new analytics-route tests), and a production `npm run build -w apps/web` (the analytics page is
its own lazy-loaded chunk).

### What shipped

- **`computeStreak`** (`packages/core/src/streak.ts`) — a pure consecutive-user-day counter.
  Deliberately takes already-resolved UTC-midnight "user-day" `Date`s and does whole-day
  millisecond arithmetic only; all timezone/day-start-hour resolution stays one layer up in
  `startOfUserDay` (`packages/shared`), same division of responsibility as `date-utils.ts`. Not
  breaking the current streak when *today* has no session yet (only when a whole day is skipped)
  matches FR-7.3's "consecutive days" reading.
- **`packages/db/src/analytics.ts`** — one new module, six functions, one per `/analytics/*`
  route:
  - `computeDashboardAnalytics` (FR-7.2, FR-7.3): today's summary (topics reviewed, questions
    attempted, accuracy, minutes) grouped by `StudySession.studiedOn` directly (it already
    encodes the correct user-day bucket at write time, per FR-5.9 — no further timezone math
    needed there), plus `computeStreak` and a 365-day activity calendar.
  - `computeMastery` (FR-7.4) and `computeHeatmap` (FR-7.5) both compute **own** (not aggregate)
    competency score per topic in one subject, in two bulk queries — the same shape as
    `topic-metrics.ts`'s per-topic loop, kept as a separate, self-contained implementation here
    (not a refactor of `topic-metrics.ts`) to avoid touching that already-tested code path.
    `computeHeatmap` additionally classifies each topic as `neverStarted` / `neglected` / `scored`
    — a distinction the shared `HealthStatus` enum can't express (`neglected` and a merely low
    score both collapse into `atRisk` there), which is exactly what FR-7.5 requires be visually
    distinct.
  - `computeTopicHealthView` (FR-7.6) — cross-subject, the same bulk-read shape as
    `review-queue.ts`'s `computeEligibleTopicItems` (per the P8 handover note), but WITHOUT that
    function's "has an active schedule" filter, since the Health View must also list
    never-studied topics. `reviewTrend` (▲▼▬) comes from the topic's last two `CompetencySnapshot`
    rows — a new `CompetencySnapshotRepository.listAllForUser` bulk method was added (same pattern
    as the three P8 `listAllForUser` additions) so this doesn't N+1 per topic.
  - `computeRetentionSeries` (FR-7.7) — `events` are actual `CompetencySnapshot` points; the
    dashed `projection` between them holds each snapshot's stored `accuracyComponent`/
    `confidenceComponent` constant and re-decays only the recency term
    (`exp(-Δt / intervalApprox)`, same shape as `computeCompetencyScore`), sampled at a step that
    caps the series at ~400 points regardless of range. **Documented approximation**: since the
    exact scheduling interval in effect *at the time of each historical review* isn't
    reconstructable from stored data, the gap between two consecutive snapshots' `capturedOn`
    stands in for it. Supports a single topic directly, or (also documented as an approximation)
    a whole subject via an unweighted mean of every topic's projected value at each shared sample
    date — a simplification of §7.3's activity-weighted roll-up, which would need per-date
    weights this endpoint has no cheap way to reconstruct.
  - `computeAccuracyConfidenceSeries` (FR-7.8) — one point per session (not per day), sorted
    oldest-first, for a topic or a whole subject, with confidence pre-normalised to the same
    0..1 scale as accuracy for a shared axis.
- **Routes** (`packages/api-core/src/routes/analytics.ts`): `GET /analytics/dashboard`,
  `/mastery`, `/heatmap`, `/health`, `/retention`, `/accuracy-confidence`. `/retention` and
  `/accuracy-confidence` take exactly one of `topicId`/`subjectId` (400 if both or neither);
  every route verifies ownership of any `topicId`/`subjectId` query param up front (404, not a
  silently-empty 200) before calling into `packages/db`.
- **Shared schemas** (`packages/shared/src/analytics.ts`) — one response schema (plus item-level
  schemas/types, e.g. `MasteryTopic`, `HeatmapTopic`) per route, mirroring the `packages/db`
  return types exactly, same convention as every prior phase's `packages/shared` module.
- **Frontend** (`apps/web`): `recharts` added as a new dependency (pure JS, no native binaries —
  installed cleanly despite this machine's corporate-proxy binary-download blocking noted
  earlier in this file). New `/analytics` route and nav link, with a subject selector + tabs
  (Health view / Mastery / Heatmap / Retention / Accuracy vs confidence) in
  `pages/analytics/analytics-page.tsx`. Every chart (`components/charts/*`) is wrapped in
  `ChartWithDataTable`, a `<details>` disclosure exposing the same data as an HTML table (NF-4).
  The topic heatmap grid pairs colour with an icon + text label for `neverStarted`/`neglected`
  cells rather than relying on colour alone (NF-4). The Topic Health View
  (`pages/analytics/topic-health-table.tsx`) is sortable on every column (click a header) and
  filterable by a name/subject text box plus a health-status dropdown. The dashboard
  (`dashboard-page.tsx`) now also shows today's summary cards, streak, and a GitHub-style
  365-day activity calendar (`components/activity-calendar.tsx`, plain CSS grid, not Recharts).
  `queryKeys.analytics.*` added; `invalidations.afterSessionWrite` now also invalidates the whole
  `['analytics']` query-key prefix, since a session write can change every P9 view at once and
  none of them has a narrower key worth targeting individually.
- **NF-1 performance**: not separately load-tested against the plan's 20-subject/2,000-topic/
  20,000-session target in this phase — every new query follows the same "N bulk reads via
  `Promise.all`, then in-memory grouping" shape already used (and implicitly exercised) by
  `review-queue.ts`/`topic-metrics.ts`, but no dedicated large-dataset seed/measurement was run.
  Flagged for follow-up rather than guessed at.

### Deferred / not in scope for P9

- **NF-1's explicit large-dataset measurement** (20 subjects / 2,000 topics / 20,000 sessions,
  numbers recorded) — see above; not run this phase.
- **A generic topic picker across subjects** for Retention/Accuracy-vs-confidence's "whole
  subject vs one topic" selector — the dropdown only lists topics within the currently-selected
  subject (via `GET /topics?subjectId=`), same reachability limit the P8 handover noted for the
  launch dialog's `topicSubtree` mode; there's still no topic search/autocomplete endpoint.
  Functionally complete for FR-7.7/FR-7.8, just not reachable from every conceivable path.
  (Adding `queryKeys.topics.listBySubject` for this reuses, rather than duplicates, the existing
  `/topics?subjectId=` list endpoint.)
- **Subject-level retention curve accuracy** — see the documented approximation above; correct
  for a single topic, illustrative (not exact) for a whole subject.
- Tree/list virtualisation for the Topic Health View — the P8 handover flagged this as worth
  evaluating once P9's larger lists existed; not added, since no seeded dataset in this phase was
  large enough to demonstrate a real need.

### Decisions taken

- **`computeMastery`/`computeHeatmap` are self-contained, not a refactor of
  `topic-metrics.ts`** — accepted the small duplication (each re-implements the same
  per-topic `computeCompetencyScore` loop) rather than extracting a shared helper, to avoid any
  risk of changing behaviour under `topic-metrics.ts`'s existing (already-relied-upon) tests.
- **Topic Health View has no "has an active schedule" eligibility filter**, unlike the P8 review
  queue's `computeEligibleTopicItems` — a deliberate divergence: FR-7.6 explicitly wants
  never-studied topics visible (`healthStatus: 'notStarted'`), where the queue explicitly wants
  them excluded (nothing to review yet).
- **Decay projection holds `accuracyComponent`/`confidenceComponent` constant between reviews and
  only re-decays the recency term** — matches §7.1's own model (those two components only change
  when a new session is logged), and reuses the exact stored values rather than re-deriving them,
  at the cost of approximating the historical scheduling interval (see above).
- **Retention/accuracy-confidence charts are Recharts `ComposedChart`/`LineChart`s with a
  `<details>` data-table fallback**, rather than a custom SVG chart — keeps the implementation
  small and leans on `recharts`'s built-in `ResponsiveContainer`/`Tooltip`, at the cost of a
  larger JS bundle for that one lazy-loaded route (~440 kB uncompressed, ~119 kB gzipped) — this
  is a `apps/web` browser bundle, not the Workers script NF-14 actually constrains, so accepted
  without further optimisation.

### Handover to P10+

- `queryKeys.topics.listBySubject(subjectId)` is a new, general-purpose key (backed by the
  existing `GET /topics?subjectId=` endpoint) — reuse it rather than adding a fourth topic-list
  query key if another P10 screen needs the same data.
- The `['analytics']` broad-prefix invalidation in `afterSessionWrite` is intentionally coarse;
  if a future P10 settings change (e.g. editing scoring weights/thresholds) should also refresh
  every analytics view, invalidate the same prefix from wherever that settings mutation lives.
- NF-1's large-dataset performance measurement (20/2,000/20,000) is still outstanding — P10's own
  NF-1-adjacent acceptance criteria (if any) or a dedicated perf pass should pick this up using
  `npm run seed:demo`-style data generation at that scale.

## P10 — Settings, Data Export, Accessibility & E2E

**Status:** Complete, with the Docker/self-hosted deployment target implemented but **not
runtime-verified** — no Docker available on this development machine (same caveat as P1's
PostgreSQL path). Verified via `npm run typecheck`, `npm run lint`, `npm test` (140 passed),
`npm run test:integration` (127 passed, including 19 new settings/export tests),
`npm run test:cf` (5 passed), `npm run test:coverage` (267 tests, 92.11% overall / 99.04%
`packages/core` line coverage — both above the NF-6 gate), `npm run audit` (passes with one
documented exception), and `npm run test:e2e` (2 passed, real browser via Playwright).

### What shipped

- **Settings API** (`packages/api-core/src/routes/settings.ts`, FR-8.1/FR-8.2): `GET/PATCH
  /me/settings` (timezone, day-start hour, default algorithm, manual interval ladder, neglect
  threshold, scoring weights, health thresholds), `POST /me/settings/reset-scoring` (resets only
  the scoring-weight/threshold fields to platform defaults), `POST /me/settings/preview` — a live
  preview of a proposed weight/threshold change scored against a real topic (a caller-supplied
  `topicId`, or the user's own topic with the most sessions if omitted; `null` if the user has no
  topics at all). Validation always runs against the **final, merged** settings (existing row +
  the requested patch), not just the fields present in one request — a single-field PATCH (e.g.
  just `dayStartHour`) is never rejected for a weights-sum reason unrelated to what it's actually
  changing, but a PATCH that *would* leave the weights not summing to 1.0, or
  `needsReviewThreshold >= strongThreshold`, is rejected either way. `packages/db/src/
  settings-preview.ts` is a standalone module (not a `topic-metrics.ts` reuse) since it needs to
  score the same topic twice, once per weight set.
- **Export API** (`packages/api-core/src/routes/export.ts`, `packages/db/src/export.ts`,
  FR-9.1-FR-9.3): `GET /export/json` streams a complete, versioned (`version: 1`), lossless JSON
  export — every collection (subjects, topics, sessions, schedules, snapshots, tags, topic-tag
  links) is read in fixed-size (500-row) pages via a new `ReadableStream`-based writer rather
  than one unbounded `findMany` per collection (§14.4's D1/Workers-limits discipline, applied
  uniformly even though SQLite/PostgreSQL could technically do it in one query). Deliberately
  excludes `passwordHash` and `RefreshToken` rows — auth secrets, not study data, and meaningless
  to re-import into a fresh account anyway. `GET /export/sessions.csv` is filterable by
  `subjectId`/`from`/`to` and applies the CSV-injection defence required by §11.2 A03
  (`sanitiseCsvCell` prefixes any cell starting with `= + - @` with a single quote) — covered by
  an explicit test using a real `=cmd|...` payload in a session note, per the phase's own
  acceptance criteria wording. Five repository methods (`subjects.list`, `topics.listAllForUser`,
  `studySessions.listAllForUser`, `reviewSchedules.listAllForUser`,
  `competencySnapshots.listAllForUser`, `tags.list`) gained optional `{ skip, take }` pagination
  params, and `tags` gained a new bulk `listAllTopicTagsForUser`, to support the internal paging
  both export functions need.
- **Settings UI** (`apps/web/src/pages/settings/settings-page.tsx`): timezone (free-typed IANA
  identifier with a `<datalist>` of common zones, validated server-side either way), day-start
  hour, default algorithm, a manual-interval-ladder editor (add/remove/edit steps), neglect
  threshold, the three scoring weights with a live running-sum indicator, the two health
  thresholds, a "Reset to defaults" button, and a live preview panel (calls
  `POST /me/settings/preview` on every keystroke, same "cheap enough locally, no debounce needed"
  convention P7's grade-preview established) showing a real topic's current vs proposed
  score/health side by side.
- **Export UI** (`apps/web/src/pages/settings/export-page.tsx`): a "Download JSON export" button
  and a CSV form (subject dropdown + date range) — both trigger a real browser file download via
  `fetch` + `Blob` + a synthetic anchor click, deliberately **not** routed through the typed
  `apiFetch` helper (these endpoints return raw files, not a Zod-validated JSON body).
- **Coverage gate wired for real (NF-6, task 7)** — `@vitest/coverage-v8@2.1.9` is now a real,
  committed devDependency (previously only self-verified locally and explicitly deferred to this
  phase per P3's own handover note). A **third** vitest config, `vitest.coverage.config.ts`, runs
  the fast unit suite AND the real-database integration suite together in one process
  (`npm run test:coverage`) with thresholds (`lines/functions/branches/statements`: 70% overall,
  90% for `packages/core/src/**`) — measuring from the unit suite alone showed ~37% (most of
  `packages/db`/`packages/api-core/src/routes` is only exercised by the integration suite), so a
  combined run was necessary for an honest number. Both thresholds pass comfortably (92.11%/
  99.04%). Wired into CI as a dedicated `coverage` job.
- **Dependency audit gate (SEC-9, task 8)** — `npm run audit` wraps `npm audit --omit=dev --json`
  via a small script (`scripts/check-audit.mjs`) rather than calling `npm audit` directly, so
  exactly one documented, non-reachable finding (GHSA-ggr8-5vv4-36mx, `deepmerge-ts` via the
  `prisma` CLI devDependency's `@prisma/config` — reachable only from `prisma generate`/`migrate`
  against our own trusted schema files, never from `@prisma/client`'s runtime code) can be
  allowlisted by GHSA id with a written reachability justification, instead of either permanently
  red CI or silently lowering the whole gate to `critical`-only. Wired into CI as a dedicated
  `dependency-audit` job. Security headers/CSP on real responses (the other half of task 8) were
  already covered by P2's `index.test.ts` — re-verified still passing, nothing new needed there.
- **Playwright E2E suite (task 6)** — `e2e/full-flow.spec.ts`, one long acceptance walkthrough
  matching the plan's own list almost verbatim: first-run admin seed → login → forced password
  change → re-login → create a subject and topic → log a session → start and complete a review
  launcher run → view analytics → export → change settings. Runs against the real T1 loop (Vite +
  Node API, SQLite) via a dedicated scratch database (`scripts/e2e-server.mjs`, wired as
  Playwright's `webServer`) — never the developer's own `dev.db`. `apps/api/src/seed-admin.ts`
  gained one small, backwards-compatible addition: an optional `SEED_ADMIN_PASSWORD` env override
  (falls back to the usual random one-time password for every other caller) so the E2E suite can
  log in with a known credential. `npx playwright install chromium` hit the same corporate-CA
  issue as Prisma's binary downloads (`unable to get local issuer certificate`) — fixed the same
  way, with `NODE_OPTIONS=--use-system-ca` for the install command only (this one isn't a proxy
  *block*, unlike the esbuild/devalue cases — it installs fine once the CA issue is resolved).
- **Automated accessibility scanning (task 5, the automated half)** — `@axe-core/playwright`, a
  second E2E test scanning the dashboard and settings pages, asserting zero `serious`/`critical`
  violations (matching the phase's own acceptance criterion). **This found a real bug**: the
  light-theme `--health-needs-review` CSS custom property (`38 92% 40%`, rendered as `#c47f08`)
  had only a 3.28:1 contrast ratio against a white card background — below WCAG AA's 4.5:1
  minimum for normal text. Fixed by darkening it to `38 92% 30%` (same hue/saturation, ~5.4:1
  contrast, comfortably over the threshold); the dark theme's own override
  (`--health-needs-review: 38 92% 55%`) was already fine and untouched. This is exactly the kind
  of finding an automated scan catches that a manual read-through easily misses — worth
  remembering that "looks fine to me" is not the same as "meets 4.5:1". The manual
  keyboard-only/screen-reader pass (task 5's other half) was not additionally re-performed this
  phase beyond what P6/P7/P8/P9 already built to (always-visible tree actions, keyboard-operable
  move dialog, icon+text health status everywhere, focus management, skip link) — no new
  violation surfaced by the axe scan beyond the one fixed above.
- **Self-hosted Docker deployment (task 10)** — a new root `docker-compose.yml` (distinct from
  `docker-compose.dev.yml`, which only ever started PostgreSQL for a host-run app) brings up
  `postgres` + `api` + `web` from a clean checkout. `apps/api/Dockerfile` runs the exact same
  `tsx src/index.ts` entrypoint `apps/api/package.json`'s own `start` script already uses locally
  (no separate compiled-JS runtime path was invented), generates the PostgreSQL Prisma client at
  build time, and runs `prisma migrate deploy` (non-interactive) at container start before
  serving. `apps/web/Dockerfile` builds the SPA and serves it via nginx
  (`apps/web/nginx.conf`), reverse-proxying `/api/*` to the `api` container with the same
  path-rewrite behaviour as `vite.config.ts`'s dev-server proxy, so the browser only ever sees one
  origin (no CORS needed) — mirroring the same-origin convenience principle FR-D.6 established
  for the Workers target. **Not verified with a real `docker build`/`docker compose up`** — no
  Docker available on this machine (confirmed via `docker --version` failing outright, and the
  user explicitly said to skip attempting Docker verification here). Whoever picks this up next
  on a machine with Docker should treat it exactly like P1 treated the unverified PostgreSQL
  integration path: run it for real before trusting it, starting with `docker compose up --build`
  and `docker compose exec api npm run seed:admin -w apps/api`.
- **Docs (task 9)** — `documents/guides/deployment.md` (Docker Compose walkthrough; PostgreSQL
  backup/restore via `pg_dump`/`psql`; SQLite backup/restore via `sqlite3 .backup`; a note that
  the in-app JSON/CSV export is a per-user convenience, not a substitute for a real database
  backup) and `documents/guides/scoring-and-scheduling.md` (a plain-language, no-formulas
  explainer of the competency score, health status, grade mapping and the three scheduling
  algorithms, for end users — not a restatement of §7/§8's implementation detail). README gained
  the new `test:coverage`/`test:e2e`/`audit` script rows and links to both new guides. The
  existing README quickstart already served as the "local development guide" T1 task 9 asks for
  (SQLite quickstart, switching to PostgreSQL, the dev compose database, seeding demo data were
  all already there from P0/P1) — not duplicated into a second document.

### Deferred / not in scope for P10

- **The Docker/self-hosted deployment target is unverified at runtime** — see above. This is the
  single biggest open item from this phase; treat it the same way the PostgreSQL integration path
  has been treated since P1 (implemented to the best of available knowledge, flagged clearly,
  first real task for whoever has the missing tooling).
- **A true manual keyboard-only/screen-reader pass** — the automated `axe` half of task 5 is real
  and found a real bug (see above); a dedicated manual pass beyond what P6-P9 already built
  in was not additionally performed. Worth doing before a real v1 release, not blocking for this
  exercise.
- **NF-1's large-dataset performance measurement (20 subjects/2,000 topics/20,000 sessions)** —
  still outstanding, carried over from P9's own handover note; no dedicated perf pass was run
  this phase either.
- **PostgreSQL/D1 runtime verification** — unchanged from every prior phase's inherited status.
- **`react-router`/`react-router-dom`'s two moderate-severity advisories** (open redirect via
  backslash, arbitrary constructor injection in SSR hydration — neither applicable here, this app
  has no SSR) were left as-is: `--audit-level=high` doesn't fail on them, and the available fix
  (`react-router-dom@7.18.3`) is a major-version bump outside this phase's scope. Worth doing as
  a deliberate, tested upgrade later, not a drive-by dependency bump here.

### Decisions taken

- **Settings validation always checks the FINAL merged state**, not just fields present in one
  PATCH request — lets a user change one field at a time without the weights-sum/threshold-order
  invariants getting in the way, while still genuinely enforcing them against what the row will
  look like afterward.
- **The JSON export is deliberately NOT fully lossless in one respect**: `passwordHash` and
  `RefreshToken` rows are excluded on purpose (auth secrets, meaningless to re-import). The
  phase's acceptance criterion ("re-imported by hand... reproduces the original data") is read as
  applying to *study data*, which is what every other field of the export covers completely.
- **The coverage gate measures unit + integration together**, not the unit suite alone — the
  right answer for "what % of this codebase is actually tested", given this project's established
  convention (since P1) of testing routes/repositories against a real database rather than
  mocking Prisma.
- **The dependency-audit gate is a small wrapper script with one documented allowlist entry**,
  not a bare `npm audit --audit-level=high` — the alternative (accepting the `npm audit fix`
  resolution that desynced the `prisma` CLI from `@prisma/client` and broke every integration
  test) was strictly worse. See repo memory (`/memories/repo/environment.md`) for the full
  incident writeup — re-read it before ever running `npm audit fix`/`fix --force` on this repo
  again.
- **Docker images run the same `tsx`-direct entrypoint as local dev**, not a separately-built
  compiled-JS path — consistency with what this repo's own scripts already exercise and trust,
  rather than introducing a second, never-tested runtime path.

### Handover to P11

- The Docker deployment target (task 10) is the first thing to actually run on a machine with
  Docker available, before P11 assumes anything about it working.
- `packages/db/src/export.ts`'s pagination pattern (`{ skip, take }` on five repository methods,
  a small `paginate()` async generator) is the template to reuse if D1 (P11) ever needs its own
  bounded-read discipline for a bulk export-like operation — D1/Workers is exactly the
  environment §14.4 had in mind when this phase's export was required to page internally rather
  than issue one unbounded query.
- `scripts/check-audit.mjs`'s allowlist is intentionally tiny (one entry) and reviewed with a
  written reachability justification — if P11 introduces new Cloudflare-side dependencies with
  their own advisories, extend the SAME pattern rather than loosening `--audit-level` or adding a
  second, parallel audit mechanism.
- The E2E suite (`e2e/full-flow.spec.ts`) is written against the T1 (Node/SQLite) target only; if
  P11 wants an E2E pass against a deployed Worker preview (its own task 9), it can very likely
  reuse this same spec file unmodified against a different `baseURL`/webServer config, per the
  plan's own explicit instruction that "the same Playwright suite from P10, unmodified" is what's
  expected there.

## NF-1 performance measurement (R5)

Measured with `npm run seed:perf -w apps/api` (20 subjects / 2,000 topics / 20,000 sessions, one
user, schedules and snapshots derived as real writes derive them) and `npm run perf:measure -w
apps/api` (the real Hono app in-process against that database, 3 warm-up + 20 timed requests per
endpoint). SQLite, on the development laptop. Milliseconds:

| Endpoint | p50 before | p95 before | p50 after | p95 after |
|---|---|---|---|---|
| `GET /subjects` | 5,790 | 5,873 | 185 | 202 |
| `GET /review/queue` | 887 | 961 | 159 | 177 |
| `GET /analytics/health` | 1,446 | 1,606 | 293 | 370 |
| `GET /subjects/:id/tree` | 43 | 69 | 27 | 31 |
| `GET /analytics/dashboard` | 247 | 359 | 179 | 184 |
| `GET /analytics/retention?subjectId=` | 87 | 129 | 51 | 56 |

NF-1 ("dashboard and topic tree endpoints < 300 ms p95") now passes; the dashboard was over it
(359 ms) before. What changed (see `review-remediation-plan.md` R5): bulk reads select only the
columns scoring needs (`SessionScoringRow`; building full Prisma rows for 20,000 sessions was the
dominant cost), `/subjects` makes one bulk pass for all subjects instead of ~6 queries per subject
run concurrently (which on SQLite made them contend), the dashboard loads one year of sessions
plus the distinct study days, the health view reads only each topic's latest two snapshot scores,
and subject retention reads snapshots in one query instead of one per topic.

Not done: list virtualisation for the Topic Health table. At 370 ms p95 server-side for 2,000
rows the endpoint is acceptable; it's worth revisiting only if the browser-side rendering of that
table measures slow.


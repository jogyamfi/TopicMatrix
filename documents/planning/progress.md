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


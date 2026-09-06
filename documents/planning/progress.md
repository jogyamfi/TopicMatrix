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

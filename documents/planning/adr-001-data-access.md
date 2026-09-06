# ADR-001: Data access on Cloudflare D1 — Prisma vs Kysely

**Status:** Accepted
**Date:** 2026-09-06
**Phase:** P0 (gating task 8)
**Closes:** SRS §16 Q9

## Context

The workspace layout (`packages/db`) commits to Prisma as the schema/migration source of truth
for PostgreSQL and SQLite (`prisma/model.prisma` generates all three provider schemas). D1 is the
open question: Prisma's D1 support goes through `@prisma/adapter-d1`, a "driver adapter" that lets
Prisma's client delegate raw SQL execution to the D1 binding instead of its normal engine/socket
connection. The alternative is `kysely-d1`, a typed SQL query builder with a first-class D1
dialect and no code-generation step.

This spike stood up a throwaway local D1 database via `wrangler` (`.wrangler/state/v3/d1`, no
Cloudflare account or `wrangler login` required — confirmed working offline), applied a migration
derived from `prisma migrate diff` via `wrangler d1 migrations apply --local`, and exercised both
libraries end to end inside real `workerd` using `@cloudflare/vitest-pool-workers`
(`apps/worker/src/d1-spike.cf.test.ts`, run via `npm run test:cf`).

## Decision

**Use Prisma with `@prisma/adapter-d1` for D1**, consistent with PostgreSQL and SQLite. Keep
`prisma/model.prisma` as the single schema source for all three providers.

**Critical corollary — do not use Prisma's `$transaction()` for atomic multi-statement writes on
D1.** Implement the D1 arm of the P1 `UnitOfWork` using D1's native `env.DB.batch([...])` API
directly (raw prepared statements), which is genuinely atomic. This is documented and enforced by
convention (see "Interactive transactions" below); there is no mechanical lint for it yet.

## Measurements

### (a) Does it work end to end?

Yes, for both libraries — confirmed by `apps/worker/src/d1-spike.cf.test.ts` (4 passing tests)
running inside real `workerd`, not mocked:

- Prisma + `@prisma/adapter-d1`: `prisma.healthCheck.create()` / `.findUnique()` round-trip
  correctly against the local D1 binding.
- `kysely-d1`: insert + select round-trip correctly against the same binding (evaluated, then
  removed after the decision — see "Rejected alternative" below).

One generation gotcha: the D1 Prisma client **must not** be generated with `--no-engine`.
`--no-engine` is for Prisma's newer `queryCompiler` preview feature; our schema uses the
(now-deprecated-but-functional) `driverAdapters` preview feature, which still requires the
WASM query engine to be generated and bundled — `prisma generate --schema=prisma/schema.d1.prisma`
(no `--no-engine`) is correct. Prisma 6.19 warns that `driverAdapters` no longer needs to be
listed under `previewFeatures` at all (it's stable-by-default); P1 should drop the preview flag.

### (b) Compressed bundle size (NF-14 limit: 3 MB compressed)

Measured via `wrangler deploy --dry-run --outdir dist` on the actual `apps/worker` entrypoint
(temporarily importing each library to get a realistic number, then reverted):

| Variant | Raw upload | Gzip |
|---|---|---|
| Baseline (`@topicmatrix/api-core` only, no DB library) | 235.46 KiB | 44.68 KiB |
| + `@prisma/client` (D1, WASM engine) + `@prisma/adapter-d1` | 2355.87 KiB | 867.40 KiB |
| + `kysely` + `kysely-d1` | 235.89 KiB | 44.76 KiB |

Both fit comfortably under the 3 MB **compressed** limit. But Prisma's WASM query engine adds
**~823 KiB gzip (~10×)** over baseline, consuming roughly 27% of the entire budget before any
application routes, models, or other dependencies exist. Kysely's overhead is negligible (+80
bytes gzip). This is a real cost of the Prisma decision that P9–P11 bundle-size work must budget
for; it is accepted here because 3 MB still leaves comfortable headroom and schema consistency
across providers was judged more valuable than the size difference (see "Rationale").

### (c) Pain of no interactive transactions for a two-table write

This is the most important finding of the spike, and it changes *how* D1 must be used, not just
*which library*:

- D1 has **no real transaction support at all** — not `BEGIN`/`COMMIT`, not driver-level
  interactive transactions. The only atomicity primitive D1 offers is its native
  `env.DB.batch([...])` API (an array of prepared statements executed as one atomic unit).
- **Prisma's interactive `$transaction(async (tx) => {...})` throws synchronously**, with a clear
  error: *"Cloudflare D1 does not support interactive transactions. We recommend you to refactor
  your queries with that limitation in mind, and use batch transactions with
  `prisma.$transactions([])` where applicable."* This is a hard, loud failure — safe by default.
- **Prisma's array-form `$transaction([op1, op2])` does NOT throw and does NOT map to D1's atomic
  `batch()` API.** It logs a warning (`prisma:warn`) and silently executes each operation as an
  independent, non-atomic query: *"Cloudflare D1 does not support transactions yet. When using
  Prisma's D1 adapter, implicit & explicit transactions will be ignored and run as individual
  queries, which breaks the guarantees of the ACID properties of transactions."* A caller who
  doesn't watch logs would reasonably believe this call is atomic. **It is not.** This is the
  genuine "pain" the spike was designed to surface: Prisma's own recommended migration path for
  the interactive-transaction failure (switch to array-form `$transaction`) quietly produces code
  that looks atomic but isn't.
- `kysely-d1`'s `.transaction().execute(...)` fails the same way Prisma's interactive form does —
  it throws `"Transactions are not supported yet."` — an honest hard failure, not a silent
  downgrade.
- D1's raw `env.DB.batch([...])` **is genuinely atomic** (per Cloudflare's D1 documentation) and
  was proven to work directly against prepared statements in the spike test, independent of either
  library.

**Consequence for P1:** the D1 implementation of `UnitOfWork` (delivery-plan.md P1 task 7) must
build its multi-statement writes as an array of D1 prepared statements passed to
`env.DB.batch([...])` directly, and must never rely on Prisma's `$transaction()` (either form) to
provide atomicity on this provider. Prisma remains the query/read layer and the source of
generated types; the atomic-write path is a deliberate, narrow escape hatch to the raw binding.

## Rejected alternative: kysely-d1

`kysely-d1` was spiked to the same depth as Prisma (single insert/read, `.transaction()`, raw
`.batch()`) and genuinely works, with a ~10× smaller bundle footprint. It was **not** chosen as
the general D1 query layer because:

- It would fragment the single-schema-source-of-truth convention fixed at P0 (`prisma/model.prisma`
  → generated schemas for all three providers). Using Kysely for D1 only would mean hand-maintaining
  a second, parallel set of typed table interfaces for D1 that must be kept in sync with the Prisma
  model by hand, for every future model change through P1–P11.
- It does not solve the transaction problem any differently than the recommended Prisma escape
  hatch (raw `env.DB.batch()`) — that native API is available regardless of which query builder
  is used elsewhere, so keeping Kysely around bought no additional safety, only a second library to
  maintain.
- Its bundle-size advantage (~823 KiB gzip) is real but not decisive: the 3 MB compressed budget
  has headroom, and bundle size is revisited with real measurements at P11 (NF-14) once actual
  application code exists.

`kysely` / `kysely-d1` have been removed from `apps/worker`'s dependencies after this decision;
they are not part of the P0 deliverable.

## Rationale for the Prisma decision

1. **One schema, one migration story, three providers.** `prisma/model.prisma` +
   `scripts/generate-schemas.ts` already generates SQLite, PostgreSQL and D1 schemas from one
   source. Committing to Prisma end-to-end means model changes (P1 onward) are written once.
2. **Generated types flow straight into repositories and Zod-inferred API shapes** without a
   second hand-maintained type layer.
3. **The transaction gap is real but containable.** It affects exactly one place per aggregate
   write path (the `UnitOfWork` D1 implementation), not every query. A narrow, well-documented
   escape hatch (raw `batch()`) is a smaller long-term liability than maintaining two query
   libraries with two different schemas.
4. **Bundle size is a real but survivable cost**, tracked explicitly for P11.

## Environment notes (reproducing this spike)

- Local D1 works fully offline: `wrangler d1 execute <name> --local --command "..."` and
  `wrangler d1 migrations apply <binding> --local`, no Cloudflare account needed (confirms
  NF-11a / T1 is unaffected by any of this).
- `@cloudflare/vitest-pool-workers` peer-depends on Vitest; use a version matching this repo's
  pinned Vitest major (`^0.6.x` for Vitest 2.x — the latest `0.22.x` requires Vitest 4).
- D1 migrations under `@cloudflare/vitest-pool-workers` use an isolated per-run database, not the
  persisted `.wrangler/state` one — apply them via `readD1Migrations` (vitest config) +
  `applyD1Migrations` (a `setupFiles` script), see `vitest.workers.config.ts` and
  `apps/worker/test/apply-d1-migrations.ts`.
- This machine's environment required two workarounds unrelated to the D1 decision itself
  (corporate proxy binary-download blocking, TLS interception without Node's CA bundle trusting
  it) — recorded in repo memory (`/memories/repo/environment.md`), not repeated here since they
  are machine-specific, not project decisions.

// P0 D1 spike (delivery-plan.md task 8): proves Prisma+@prisma/adapter-d1 works end to end
// against a real D1 binding inside workerd, and documents D1's lack of real transaction support
// (both Prisma's array-form and interactive-form $transaction) plus the recommended escape hatch
// (D1's native, genuinely atomic env.DB.batch() API). Findings are recorded in
// documents/planning/adr-001-data-access.md. kysely-d1 was also spiked and rejected — see the ADR.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { PrismaD1 } from '@prisma/adapter-d1';
// Relative imports bypass the package's `exports` map (which would pick `wasm.js` under the
// `workerd` condition automatically) — importing `wasm.js` directly avoids the Node-only
// `runtime/library.js` build, which statically requires `node:child_process`. driverAdapters
// mode (unlike the newer queryCompiler/--no-engine mode) still needs this WASM engine present.
import { PrismaClient } from '../../../packages/db/generated/d1/wasm.js';

interface SpikeBindings {
  DB: D1Database;
}

const bindings = env as unknown as SpikeBindings;

describe('D1 spike: @prisma/adapter-d1', () => {
  it('runs a single insert + read end to end', async () => {
    const prisma = new PrismaClient({ adapter: new PrismaD1(bindings.DB) });
    const created = await prisma.healthCheck.create({ data: {} });
    const found = await prisma.healthCheck.findUnique({ where: { id: created.id } });
    expect(found?.id).toBe(created.id);
  });

  it('array-form $transaction succeeds but is NOT atomic on D1 (Prisma degrades it to sequential queries)', async () => {
    const prisma = new PrismaClient({ adapter: new PrismaD1(bindings.DB) });
    // Prisma logs "Cloudflare D1 does not support transactions yet ... breaks the guarantees of
    // the ACID properties of transactions" (prisma:warn) when this runs — it does NOT throw, so
    // a caller could easily miss that a partial failure here would NOT roll back.
    const [a, b] = await prisma.$transaction([
      prisma.healthCheck.create({ data: {} }),
      prisma.healthCheck.create({ data: {} }),
    ]);
    expect(a.id).not.toBe(b.id);
  });

  it('interactive (callback) $transaction is rejected outright on D1', async () => {
    const prisma = new PrismaClient({ adapter: new PrismaD1(bindings.DB) });
    // Prisma throws this synchronously (not as a rejected promise) — `expect(promise).rejects`
    // would evaluate the call eagerly and let the throw escape uncaught, so wrap it in a thunk.
    await expect(async () => {
      await prisma.$transaction(async (tx) => {
        await tx.healthCheck.create({ data: {} });
        await tx.healthCheck.create({ data: {} });
      });
    }).rejects.toThrow(/does not support interactive transactions/);
  });

  it('recommended escape hatch: D1 native env.DB.batch() IS genuinely atomic — use it directly for multi-statement writes, never Prisma $transaction (P1 UnitOfWork)', async () => {
    const id1 = `batch-${crypto.randomUUID()}`;
    const id2 = `batch-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const results = await bindings.DB.batch([
      bindings.DB.prepare('INSERT INTO "HealthCheck" (id, createdAt) VALUES (?, ?)').bind(id1, now),
      bindings.DB.prepare('INSERT INTO "HealthCheck" (id, createdAt) VALUES (?, ?)').bind(id2, now),
    ]);
    expect(results.every((r) => r.success)).toBe(true);

    const rows = await bindings.DB.prepare('SELECT id FROM "HealthCheck" WHERE id IN (?, ?)')
      .bind(id1, id2)
      .all();
    expect(rows.results).toHaveLength(2);
  });
});

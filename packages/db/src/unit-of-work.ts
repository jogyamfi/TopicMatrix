import type { PrismaClient, TransactionClient } from './types.js';

/**
 * Any multi-step write must be expressed through a UnitOfWork rather than sequential separate
 * repository calls, so the same call sites work whether the provider gives real interactive
 * transactions (sqlite/postgresql) or not (D1). Interface fixed at P1 (delivery-plan.md P1 task
 * 7); the D1 implementation is genuinely wired at P11, once a live Workers binding exists — see
 * `createD1UnitOfWork` below for why it can't be faked in the meantime.
 */
export interface UnitOfWork {
  run<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

/** sqlite/postgresql: backed by Prisma's real interactive `$transaction`. */
export function createSqlUnitOfWork(client: PrismaClient): UnitOfWork {
  return {
    run(work) {
      return client.$transaction((tx) => work(tx));
    },
  };
}

/**
 * D1 has no interactive transactions (§14.4, ADR-001): Prisma's callback-form `$transaction`
 * throws outright and its array-form silently degrades to non-atomic sequential queries — proven
 * by apps/worker/src/d1-spike.cf.test.ts. The genuinely atomic primitive D1 offers is its native
 * `env.DB.batch([...])` over a FIXED, upfront list of prepared statements — no reads permitted
 * mid-batch, which is a fundamentally different shape from "run this arbitrary callback
 * atomically". Callers that need atomic multi-step D1 writes must be restructured around that
 * constraint; that restructuring is P11's job (delivery-plan.md P11 task 3), once a live D1
 * binding exists to build and test it against. This implementation intentionally throws rather
 * than silently pretending to provide atomicity it cannot deliver.
 */
export function createD1UnitOfWork(): UnitOfWork {
  return {
    run() {
      throw new Error(
        'D1 UnitOfWork.run() is not implemented: D1 has no interactive transactions. Multi-step ' +
          'D1 writes must be expressed as a fixed batch of prepared statements via env.DB.batch() ' +
          '(see apps/worker/src/d1-spike.cf.test.ts) — wired at P11.',
      );
    },
  };
}

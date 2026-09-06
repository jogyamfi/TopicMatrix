import { argon2id, argon2Verify } from 'hash-wasm';
import { AppError } from '@topicmatrix/shared';

// Argon2id parameters and benchmarking are recorded in documents/planning/adr-002-password-hashing.md
// (delivery-plan.md P2 task 1) — this module just wraps hash-wasm with those parameters, read
// from config (AppConfig.argon2MemoryKib/argon2Iterations) so they can be tuned without a code
// change. Parallelism is fixed at 1: `workerd` is single-threaded and hash-wasm's WASM build
// does not use real threads either way, so there is nothing to gain from a higher value and it
// must stay constant for `needsRehash` comparisons to be meaningful.
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

export interface PasswordService {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  /** True if `hash` was produced with different parameters than the current config (SEC-3). */
  needsRehash(hash: string): boolean;
}

export interface PasswordServiceParams {
  memoryKib: number;
  iterations: number;
}

export function createPasswordService(params: PasswordServiceParams): PasswordService {
  return {
    async hash(password) {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      return argon2id({
        password,
        salt,
        parallelism: PARALLELISM,
        iterations: params.iterations,
        memorySize: params.memoryKib,
        hashLength: HASH_LENGTH,
        outputType: 'encoded',
      });
    },

    async verify(password, hash) {
      try {
        return await argon2Verify({ password, hash });
      } catch {
        // Malformed/foreign hash format — treat as a failed verification, not a crash.
        return false;
      }
    },

    needsRehash(hash) {
      const match = /\$m=(\d+),t=(\d+),p=(\d+)/.exec(hash);
      if (!match) return true;
      const [, memory, iterations, parallelism] = match;
      return (
        Number(memory) !== params.memoryKib ||
        Number(iterations) !== params.iterations ||
        Number(parallelism) !== PARALLELISM
      );
    },
  };
}

/**
 * Stub for runtimes where hash-wasm cannot run (Cloudflare Workers — see
 * documents/planning/adr-002-password-hashing.md: Workers disallows dynamic WebAssembly
 * compilation from in-memory bytes, which is exactly how hash-wasm loads its Argon2
 * implementation). Fails loudly and clearly rather than silently returning a bogus result;
 * wiring a real Workers-compatible implementation is a P11 task.
 */
export function createUnavailablePasswordService(reason: string): PasswordService {
  const fail = (): never => {
    throw new AppError('INTERNAL_ERROR', `Password hashing is unavailable in this runtime: ${reason}`);
  };
  return {
    hash: () => fail(),
    verify: () => fail(),
    needsRehash: () => fail(),
  };
}

// P2 Argon2id / Workers compatibility spike (delivery-plan.md task 1, gating this phase) —
// proves, inside REAL workerd (not just Node), whether hash-wasm's Argon2id can run there at
// all. Finding and its consequences are recorded in
// documents/planning/adr-002-password-hashing.md: Cloudflare Workers disallows dynamic
// WebAssembly compilation from in-memory bytes (only statically-`import`ed `.wasm` modules
// bundled at build time are permitted — see Cloudflare's own Wasm-in-JavaScript docs), and
// hash-wasm's architecture (base64-embedded binaries decoded and passed to
// `WebAssembly.compile()` at first use) is exactly that disallowed pattern. This is a standing
// regression test: if a future workerd release changes this, it should fail loudly here rather
// than the finding silently going stale.
import { describe, expect, it } from 'vitest';
import { argon2id } from 'hash-wasm';

describe('Argon2id (hash-wasm) on workerd', () => {
  it('cannot run — Workers disallows dynamic WebAssembly compilation (ADR-002)', async () => {
    await expect(
      argon2id({
        password: 'benchmark-password-not-real',
        salt: new Uint8Array(16),
        parallelism: 1,
        iterations: 2,
        memorySize: 19456,
        hashLength: 32,
        outputType: 'encoded',
      }),
    ).rejects.toThrow(/Wasm code generation disallowed/);
  });
});

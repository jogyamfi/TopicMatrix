import { describe, expect, it } from 'vitest';
import { createPasswordService } from './password.js';

const params = { memoryKib: 19456, iterations: 2 };

describe('createPasswordService', () => {
  it('hashes a password and verifies it correctly', async () => {
    const service = createPasswordService(params);
    const hash = await service.hash('correct-horse-battery');
    expect(await service.verify('correct-horse-battery', hash)).toBe(true);
    expect(await service.verify('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash (different salt) for the same password each time', async () => {
    const service = createPasswordService(params);
    const [a, b] = await Promise.all([service.hash('same-password'), service.hash('same-password')]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed hash as a failed verification rather than throwing', async () => {
    const service = createPasswordService(params);
    await expect(service.verify('anything', 'not-a-real-hash')).resolves.toBe(false);
  });

  it('needsRehash is false for a hash produced with the current params, true for different params', async () => {
    const service = createPasswordService(params);
    const hash = await service.hash('correct-horse-battery');
    expect(service.needsRehash(hash)).toBe(false);

    const olderService = createPasswordService({ memoryKib: 8192, iterations: 1 });
    const staleHash = await olderService.hash('correct-horse-battery');
    expect(service.needsRehash(staleHash)).toBe(true);
  });

  // Node-side timing for the ADR-002 candidates (documents/planning/adr-002-password-hashing.md)
  // — not a strict perf assertion (machine-dependent), just a generous ceiling plus visible
  // numbers on every test run so a regression would be noticed.
  it.each([
    { label: '19456 KiB, t=2, p=1 (current default)', memoryKib: 19456, iterations: 2 },
    { label: '19456 KiB, t=1, p=1', memoryKib: 19456, iterations: 1 },
    { label: '8192 KiB, t=2, p=1', memoryKib: 8192, iterations: 2 },
    { label: '46875 KiB, t=1, p=1 (OWASP alt.)', memoryKib: 46_875, iterations: 1 },
  ])('$label completes in well under 1s on Node', async ({ memoryKib, iterations }) => {
    const service = createPasswordService({ memoryKib, iterations });
    const start = performance.now();
    await service.hash('benchmark-password-not-real');
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

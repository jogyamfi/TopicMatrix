// Real Prisma-backed client, adapters and userId-scoped repositories land at P1.
// This placeholder only exists so packages/api-core has something to inject as `db`.
export interface Db {
  readonly kind: 'placeholder';
}

export function createPlaceholderDb(): Db {
  return { kind: 'placeholder' };
}

-- D1 SQL derived from prisma/migrations/20260906122251_init (via `prisma migrate diff`, P0 task 8).
-- Applied with `wrangler d1 migrations apply` — see documents/planning/adr-001-data-access.md.
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

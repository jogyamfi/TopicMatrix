-- D1 SQL for the P2 AuditLog table, hand-derived from prisma/d1/schema.prisma (§11.2 A09) —
-- generated the same way as 0001_init.sql (`prisma migrate diff --from-empty
-- --to-schema-datamodel`), just the incremental table rather than the full schema.
-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

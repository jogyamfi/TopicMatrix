-- R2 (documents/planning/review-remediation-plan.md): data steps first, then the schema diff
-- generated offline with `prisma migrate diff --from-schema-datamodel <previous> --to-schema-datamodel <current>`.

-- D-1: one suspend flag. A topic suspended at EITHER level stays suspended, now on Topic only,
-- before ReviewSchedule's copy of the flag is dropped below.
UPDATE "Topic" SET "isSuspended" = true
WHERE "id" IN (SELECT "topicId" FROM "ReviewSchedule" WHERE "isSuspended" = true);

-- D-5: dense, deterministic sibling order. Every topic used to be created with sortOrder 0, so
-- siblings tied and the Up/Down reorder swapped 0 with 0. Renumber each sibling group 0..n-1,
-- keeping the current order (sortOrder, then creation time, then id as a final tiebreak).
UPDATE "Topic" SET "sortOrder" = "ranked"."position"
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "subjectId", "parentId" ORDER BY "sortOrder", "createdAt", "id") - 1 AS "position"
  FROM "Topic"
) AS "ranked"
WHERE "Topic"."id" = "ranked"."id";

-- AlterTable
ALTER TABLE "ReviewSchedule" DROP COLUMN "isSuspended";

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "replacedByTokenId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");


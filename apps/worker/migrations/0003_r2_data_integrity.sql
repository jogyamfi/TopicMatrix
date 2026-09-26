-- D1 SQL for R2 (documents/planning/review-remediation-plan.md): data steps first, then the schema diff
-- generated offline with `prisma migrate diff --from-schema-datamodel <previous> --to-schema-datamodel <current>`.

-- D-1: one suspend flag. A topic suspended at EITHER level stays suspended, now on Topic only,
-- before ReviewSchedule's copy of the flag is dropped below.
UPDATE "Topic" SET "isSuspended" = 1
WHERE "id" IN (SELECT "topicId" FROM "ReviewSchedule" WHERE "isSuspended" = 1);

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

-- D1 always enforces foreign keys (PRAGMA foreign_keys can't be turned off there); the
-- ReviewSchedule rebuild below doesn't need it off, since no table references ReviewSchedule.
-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN "replacedByTokenId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
CREATE TABLE "new_ReviewSchedule" (
    "topicId" TEXT NOT NULL PRIMARY KEY,
    "algorithm" TEXT NOT NULL,
    "lastReviewedOn" DATETIME,
    "nextReviewOn" DATETIME,
    "intervalDays" INTEGER,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL,
    "stability" REAL,
    "difficulty" REAL,
    "manualLadderIndex" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewSchedule_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReviewSchedule" ("algorithm", "difficulty", "easeFactor", "intervalDays", "lapses", "lastReviewedOn", "manualLadderIndex", "nextReviewOn", "repetitions", "stability", "topicId", "updatedAt") SELECT "algorithm", "difficulty", "easeFactor", "intervalDays", "lapses", "lastReviewedOn", "manualLadderIndex", "nextReviewOn", "repetitions", "stability", "topicId", "updatedAt" FROM "ReviewSchedule";
DROP TABLE "ReviewSchedule";
ALTER TABLE "new_ReviewSchedule" RENAME TO "ReviewSchedule";
CREATE INDEX "ReviewSchedule_nextReviewOn_idx" ON "ReviewSchedule"("nextReviewOn");
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");


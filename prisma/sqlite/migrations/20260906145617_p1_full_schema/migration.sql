-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "emailNormalised" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LEARNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "dayStartHour" INTEGER NOT NULL DEFAULT 4,
    "defaultAlgorithm" TEXT NOT NULL DEFAULT 'fsrs',
    "manualIntervalsJson" TEXT NOT NULL DEFAULT '[1,3,7,14,30,60]',
    "neglectThresholdDays" INTEGER NOT NULL DEFAULT 30,
    "weightAccuracy" REAL NOT NULL DEFAULT 0.60,
    "weightConfidence" REAL NOT NULL DEFAULT 0.25,
    "weightRecency" REAL NOT NULL DEFAULT 0.15,
    "strongThreshold" REAL NOT NULL DEFAULT 75,
    "needsReviewThreshold" REAL NOT NULL DEFAULT 50,
    "theme" TEXT NOT NULL DEFAULT 'system',
    CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalised" TEXT NOT NULL,
    "description" TEXT,
    "colour" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "defaultAlgorithm" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "nameNormalised" TEXT NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "algorithmOverride" TEXT,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Topic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Topic_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studiedOn" DATETIME NOT NULL,
    "sourceLabel" TEXT,
    "questionsAttempted" INTEGER NOT NULL,
    "questionsCorrect" INTEGER NOT NULL,
    "accuracy" REAL NOT NULL,
    "confidence" INTEGER NOT NULL,
    "durationMinutes" INTEGER,
    "notes" TEXT,
    "gradeUsed" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudySession_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewSchedule" (
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
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewSchedule_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetencySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "capturedOn" DATETIME NOT NULL,
    "score" REAL NOT NULL,
    "accuracyComponent" REAL NOT NULL,
    "confidenceComponent" REAL NOT NULL,
    "recencyComponent" REAL NOT NULL,
    "triggeredBySessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetencySnapshot_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CompetencySnapshot_triggeredBySessionId_fkey" FOREIGN KEY ("triggeredBySessionId") REFERENCES "StudySession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalised" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TopicTag" (
    "topicId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("topicId", "tagId"),
    CONSTRAINT "TopicTag_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TopicTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailNormalised_key" ON "User"("emailNormalised");

-- CreateIndex
CREATE INDEX "Subject_userId_isArchived_idx" ON "Subject"("userId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_userId_nameNormalised_key" ON "Subject"("userId", "nameNormalised");

-- CreateIndex
CREATE INDEX "Topic_subjectId_parentId_idx" ON "Topic"("subjectId", "parentId");

-- CreateIndex
CREATE INDEX "Topic_path_idx" ON "Topic"("path");

-- CreateIndex
CREATE INDEX "StudySession_topicId_studiedOn_idx" ON "StudySession"("topicId", "studiedOn");

-- CreateIndex
CREATE INDEX "StudySession_userId_studiedOn_idx" ON "StudySession"("userId", "studiedOn");

-- CreateIndex
CREATE INDEX "ReviewSchedule_nextReviewOn_idx" ON "ReviewSchedule"("nextReviewOn");

-- CreateIndex
CREATE INDEX "CompetencySnapshot_topicId_capturedOn_idx" ON "CompetencySnapshot"("topicId", "capturedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_userId_nameNormalised_key" ON "Tag"("userId", "nameNormalised");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

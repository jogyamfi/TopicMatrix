// Canonical Prisma types, re-exported from the SQLite-generated client. The postgres/d1
// generated clients are schema-identical (§6.3 bans provider-specific native attributes), so
// these types describe rows/inputs for every provider — only the runtime client instance
// differs (see client.ts).
import type { PrismaClient as SqlitePrismaClient } from '../generated/sqlite/index.js';

export type PrismaClient = SqlitePrismaClient;

/** The client passed into an interactive-transaction callback — same CRUD surface, no `$transaction`. */
export type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Repositories accept either, so the same repository code works inside or outside a UnitOfWork. */
export type PrismaClientOrTx = PrismaClient | TransactionClient;

export type {
  HealthCheck,
  User,
  UserSettings,
  Subject,
  Topic,
  StudySession,
  ReviewSchedule,
  CompetencySnapshot,
  Tag,
  TopicTag,
  RefreshToken,
  AuditLog,
} from '../generated/sqlite/index.js';

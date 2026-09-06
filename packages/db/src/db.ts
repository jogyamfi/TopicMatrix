import type { AppConfig } from '@topicmatrix/shared';
import { createD1UnitOfWork, type UnitOfWork } from './unit-of-work.js';
import { createUserRepository, type UserRepository } from './repositories/user.js';
import {
  createUserSettingsRepository,
  type UserSettingsRepository,
} from './repositories/user-settings.js';
import { createSubjectRepository, type SubjectRepository } from './repositories/subject.js';
import { createTopicRepository, type TopicRepository } from './repositories/topic.js';
import {
  createStudySessionRepository,
  type StudySessionRepository,
} from './repositories/study-session.js';
import {
  createReviewScheduleRepository,
  type ReviewScheduleRepository,
} from './repositories/review-schedule.js';
import {
  createCompetencySnapshotRepository,
  type CompetencySnapshotRepository,
} from './repositories/competency-snapshot.js';
import { createTagRepository, type TagRepository } from './repositories/tag.js';
import {
  createRefreshTokenRepository,
  type RefreshTokenRepository,
} from './repositories/refresh-token.js';
import { createAuditLogRepository, type AuditLogRepository } from './repositories/audit-log.js';
import type { PrismaClientOrTx } from './types.js';

export interface Db {
  readonly provider: 'sqlite' | 'postgresql' | 'd1';
  users: UserRepository;
  userSettings: UserSettingsRepository;
  subjects: SubjectRepository;
  topics: TopicRepository;
  studySessions: StudySessionRepository;
  reviewSchedules: ReviewScheduleRepository;
  competencySnapshots: CompetencySnapshotRepository;
  tags: TagRepository;
  refreshTokens: RefreshTokenRepository;
  auditLogs: AuditLogRepository;
  unitOfWork: UnitOfWork;
  disconnect(): Promise<void>;
}

/** Shared by node.ts (sqlite/postgresql) — kept here so both stay in sync with the `Db` shape. */
export function buildRepositories(client: PrismaClientOrTx) {
  return {
    users: createUserRepository(client),
    userSettings: createUserSettingsRepository(client),
    subjects: createSubjectRepository(client),
    topics: createTopicRepository(client),
    studySessions: createStudySessionRepository(client),
    reviewSchedules: createReviewScheduleRepository(client),
    competencySnapshots: createCompetencySnapshotRepository(client),
    tags: createTagRepository(client),
    refreshTokens: createRefreshTokenRepository(client),
    auditLogs: createAuditLogRepository(client),
  };
}

/**
 * Builds a `Db` from THIS (runtime-agnostic) module — only ever returns the 'd1' stub.
 * sqlite/postgresql construction lives in node.ts (`@topicmatrix/db/node`) and must NEVER be
 * imported from here. Discovered the hard way (documents/planning/progress.md P1 handover):
 * this module is reachable from `packages/api-core`, which `apps/worker` also imports, and
 * Prisma's regular (non-driver-adapter) generated client requires Node built-ins
 * (`node:child_process` etc.) just to load, even if the code path that uses it is never
 * executed — `wrangler`/esbuild bundles the whole reachable import graph, so a plain
 * `import { PrismaClient } from '../generated/sqlite'` anywhere in this file broke
 * `npm run test:cf` outright. Keep sqlite/postgres client construction isolated in node.ts,
 * imported ONLY by `apps/api` (and Node-context test code).
 */
export function createDb(config: AppConfig): Db {
  if (config.databaseProvider === 'd1') {
    return unimplementedD1Db();
  }

  throw new Error(
    `createDb() from the main '@topicmatrix/db' barrel does not construct '${config.databaseProvider}' ` +
      "clients — import createNodeDb from '@topicmatrix/db/node' instead (Node-only; see node.ts).",
  );
}

function unimplemented<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get(): never {
      throw new Error(
        `${what} is not implemented for the 'd1' provider yet — D1 repositories are wired at ` +
          'P11 once a live Workers binding exists. See documents/planning/progress.md.',
      );
    },
  });
}

function unimplementedD1Db(): Db {
  return {
    provider: 'd1',
    users: unimplemented('UserRepository'),
    userSettings: unimplemented('UserSettingsRepository'),
    subjects: unimplemented('SubjectRepository'),
    topics: unimplemented('TopicRepository'),
    studySessions: unimplemented('StudySessionRepository'),
    reviewSchedules: unimplemented('ReviewScheduleRepository'),
    competencySnapshots: unimplemented('CompetencySnapshotRepository'),
    tags: unimplemented('TagRepository'),
    refreshTokens: unimplemented('RefreshTokenRepository'),
    auditLogs: unimplemented('AuditLogRepository'),
    unitOfWork: createD1UnitOfWork(),
    disconnect: async () => {},
  };
}

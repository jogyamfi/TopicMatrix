export type { Db } from './db.js';
export { createDb } from './db.js';
export type { UnitOfWork } from './unit-of-work.js';
export { createSqlUnitOfWork, createD1UnitOfWork } from './unit-of-work.js';
export { createFixtures } from './fixtures.js';
export type { Fixtures } from './fixtures.js';
export { deleteUserAccount } from './account-deletion.js';
export { deleteSubjectCascade } from './subject-deletion.js';
export { moveTopic, deleteTopic } from './topic-tree.js';
export type { MoveTopicInput } from './topic-tree.js';
export { resolveAlgorithm, recalculateTopicSchedule, applyScheduleOverride } from './scheduling.js';
export type { RecalculationResult, ScheduleOverride } from './scheduling.js';
export { computeSubjectTopicMetrics, computeTopicMetrics } from './topic-metrics.js';
export type { TopicScoreMetrics } from './topic-metrics.js';

export type {
  PrismaClient,
  TransactionClient,
  PrismaClientOrTx,
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
} from './types.js';

export type { UserRepository, CreateUserInput, UpdateUserInput } from './repositories/user.js';
export type {
  UserSettingsRepository,
  UpdateUserSettingsInput,
} from './repositories/user-settings.js';
export type {
  SubjectRepository,
  CreateSubjectInput,
  UpdateSubjectInput,
} from './repositories/subject.js';
export type { TopicRepository, CreateTopicInput, UpdateTopicInput } from './repositories/topic.js';
export type {
  StudySessionRepository,
  CreateStudySessionInput,
  UpdateStudySessionInput,
} from './repositories/study-session.js';
export type {
  ReviewScheduleRepository,
  UpsertReviewScheduleInput,
} from './repositories/review-schedule.js';
export type {
  CompetencySnapshotRepository,
  CreateCompetencySnapshotInput,
} from './repositories/competency-snapshot.js';
export type { TagRepository } from './repositories/tag.js';
export type {
  RefreshTokenRepository,
  CreateRefreshTokenInput,
} from './repositories/refresh-token.js';
export type { AuditLogRepository, CreateAuditLogInput } from './repositories/audit-log.js';

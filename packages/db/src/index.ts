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
export {
  resolveAlgorithm,
  recalculateTopicSchedule,
  recalculateTopicScheduleInTx,
  recalculateTopicSchedulesInTx,
  applyScheduleOverride,
} from './scheduling.js';
export type { RecalculationResult, ScheduleOverride, ScheduleOverrideResult } from './scheduling.js';
export { logStudySession, updateStudySession, deleteStudySession } from './session-writes.js';
export type { SessionWriteResult } from './session-writes.js';
export {
  updateSubjectAndReschedule,
  updateTopicAndReschedule,
  updateSettingsAndReschedule,
} from './rescheduling.js';
export { createUserWithDefaultSettings, rotateRefreshToken } from './account-writes.js';
export { REVOKED_TOKEN_RETENTION_MS } from './repositories/refresh-token.js';
export { computeSubjectTopicMetrics, computeTopicMetrics } from './topic-metrics.js';
export type { TopicScoreMetrics } from './topic-metrics.js';
export { computeSubjectSummary } from './subject-summary.js';
export type { SubjectSummary } from './subject-summary.js';
export { computeReviewQueue, buildReviewSession } from './review-queue.js';
export type {
  ReviewQueueItem,
  ReviewQueueBuckets,
  ReviewSessionMode,
  ReviewSessionFilters,
  ReviewSessionCaps,
} from './review-queue.js';
export {
  computeDashboardAnalytics,
  computeMastery,
  computeHeatmap,
  computeTopicHealthView,
  computeRetentionSeries,
  computeAccuracyConfidenceSeries,
} from './analytics.js';
export type {
  DashboardAnalytics,
  DashboardTodaySummary,
  ActivityCalendarDay,
  MasteryTopic,
  HeatmapStatus,
  HeatmapTopic,
  ReviewTrend,
  TopicHealthRow,
  RetentionEventPoint,
  RetentionProjectionPoint,
  RetentionSeries,
  AccuracyConfidencePoint,
} from './analytics.js';
export { buildUserExportStream, buildSessionsCsv, sanitiseCsvCell, EXPORT_FORMAT_VERSION } from './export.js';
export type { SessionsCsvFilter } from './export.js';
export { computeSettingsPreview } from './settings-preview.js';
export type {
  SettingsPreviewWeightsAndThresholds,
  SettingsPreviewSide,
  SettingsPreviewResult,
} from './settings-preview.js';

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
export type { TagRepository, TopicTagLink } from './repositories/tag.js';
export type {
  RefreshTokenRepository,
  CreateRefreshTokenInput,
} from './repositories/refresh-token.js';
export type { AuditLogRepository, CreateAuditLogInput } from './repositories/audit-log.js';

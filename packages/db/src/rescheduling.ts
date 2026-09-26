import { AppError } from '@topicmatrix/shared';
import type { Db } from './db.js';
import { createSubjectRepository, type UpdateSubjectInput } from './repositories/subject.js';
import { createTopicRepository, type UpdateTopicInput } from './repositories/topic.js';
import {
  createUserSettingsRepository,
  type UpdateUserSettingsInput,
} from './repositories/user-settings.js';
import { resolveAlgorithm, recalculateTopicSchedulesInTx } from './scheduling.js';
import type { Subject, Topic, UserSettings } from './types.js';

// A topic's schedule is derived from its sessions AND from the algorithm/ladder in effect
// (topic override -> subject default -> user default, FR-5.3). These writes change that input
// for some topics, so they re-derive the affected schedules in the same UnitOfWork as the write
// itself (FR-5.7) — otherwise the stored schedule would silently keep the old algorithm's dates
// until the topic's next session. Each returns how many next-review dates actually moved, so the
// UI can tell the user.

export async function updateSubjectAndReschedule(
  db: Db,
  userId: string,
  subjectId: string,
  patch: UpdateSubjectInput,
): Promise<{ subject: Subject; schedulesChanged: number }> {
  return db.unitOfWork.run(async (tx) => {
    const subjects = createSubjectRepository(tx);
    const before = await subjects.findById(userId, subjectId);
    if (!before) {
      throw new AppError('NOT_FOUND', 'Subject not found');
    }
    const subject = await subjects.update(userId, subjectId, patch);

    if (patch.defaultAlgorithm === undefined || patch.defaultAlgorithm === before.defaultAlgorithm) {
      return { subject, schedulesChanged: 0 };
    }
    // Only topics without their own override take the subject's default.
    const affected = await tx.topic.findMany({
      where: { subjectId, algorithmOverride: null },
      select: { id: true },
    });
    const schedulesChanged = await recalculateTopicSchedulesInTx(tx, userId, affected.map((t) => t.id));
    return { subject, schedulesChanged };
  });
}

export async function updateTopicAndReschedule(
  db: Db,
  userId: string,
  topicId: string,
  patch: UpdateTopicInput,
): Promise<{ topic: Topic; scheduleChanged: boolean }> {
  return db.unitOfWork.run(async (tx) => {
    const topics = createTopicRepository(tx);
    const before = await topics.findById(userId, topicId);
    if (!before) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    const topic = await topics.update(userId, topicId, patch);

    if (patch.algorithmOverride === undefined || patch.algorithmOverride === before.algorithmOverride) {
      return { topic, scheduleChanged: false };
    }
    const changed = await recalculateTopicSchedulesInTx(tx, userId, [topicId]);
    return { topic, scheduleChanged: changed > 0 };
  });
}

export async function updateSettingsAndReschedule(
  db: Db,
  userId: string,
  patch: UpdateUserSettingsInput,
): Promise<{ settings: UserSettings; schedulesChanged: number }> {
  return db.unitOfWork.run(async (tx) => {
    const repo = createUserSettingsRepository(tx);
    const before = await repo.find(userId);
    if (!before) {
      throw new AppError('NOT_FOUND', 'User settings not found');
    }
    const settings = await repo.update(userId, patch);

    const algorithmChanged = settings.defaultAlgorithm !== before.defaultAlgorithm;
    const ladderChanged = settings.manualIntervalsJson !== before.manualIntervalsJson;
    if (!algorithmChanged && !ladderChanged) {
      return { settings, schedulesChanged: 0 };
    }

    const topics = await tx.topic.findMany({
      where: { subject: { userId } },
      select: { id: true, algorithmOverride: true, subject: { select: { defaultAlgorithm: true } } },
    });
    const affected = topics.filter((t) => {
      // The user default only reaches topics with no topic override and no subject default.
      const usesUserDefault = t.algorithmOverride === null && t.subject.defaultAlgorithm === null;
      const usesManual =
        resolveAlgorithm(t.algorithmOverride, t.subject.defaultAlgorithm, settings.defaultAlgorithm) === 'manual';
      return (algorithmChanged && usesUserDefault) || (ladderChanged && usesManual);
    });
    const schedulesChanged = await recalculateTopicSchedulesInTx(tx, userId, affected.map((t) => t.id));
    return { settings, schedulesChanged };
  });
}

import { AppError } from '@topicmatrix/shared';
import type { Db } from './db.js';

/**
 * Subject delete (FR-2.4) — cascades topics, sessions, schedules, snapshots and tag
 * associations for every topic under the subject, inside one UnitOfWork. Every relation in
 * prisma/model.prisma uses `onDelete: Restrict` (§6.3/P1), so this is hand-written in dependency
 * order rather than relying on a DB-level cascade — same convention as
 * `deleteUserAccount` (account-deletion.ts).
 */
export async function deleteSubjectCascade(db: Db, userId: string, subjectId: string): Promise<void> {
  await db.unitOfWork.run(async (tx) => {
    const subject = await tx.subject.findFirst({ where: { id: subjectId, userId } });
    if (!subject) {
      throw new AppError('NOT_FOUND', 'Subject not found');
    }

    await tx.topicTag.deleteMany({ where: { topic: { subjectId } } });
    await tx.competencySnapshot.deleteMany({ where: { topic: { subjectId } } });
    await tx.studySession.deleteMany({ where: { topic: { subjectId } } });
    await tx.reviewSchedule.deleteMany({ where: { topic: { subjectId } } });

    // Topic.parentId is a self-referential FK (onDelete: Restrict) — delete deepest-first so a
    // child is never left pointing at an already-deleted parent mid-batch (a multi-level tree,
    // P4, makes this a real case, not just a theoretical one).
    const topics = await tx.topic.findMany({ where: { subjectId } });
    const depthsDeepestFirst = [...new Set(topics.map((t) => t.depth))].sort((a, b) => b - a);
    for (const depth of depthsDeepestFirst) {
      const idsAtDepth = topics.filter((t) => t.depth === depth).map((t) => t.id);
      await tx.topic.deleteMany({ where: { id: { in: idsAtDepth } } });
    }

    await tx.subject.delete({ where: { id: subjectId } });
  });
}

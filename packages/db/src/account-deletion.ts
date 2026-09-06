import type { Db } from './db.js';

/**
 * Admin account deletion (FR-1.8) — deletes a learner's entire account: every relation in
 * prisma/model.prisma uses `onDelete: Restrict` (deliberately, §6.3/P1), so this is expressed as
 * one explicit, dependency-ordered UnitOfWork rather than relying on a DB-level cascade. Children
 * before parents: tag associations → snapshots/sessions/schedules → topics → tags/subjects →
 * refresh tokens/settings → the user row itself.
 */
export async function deleteUserAccount(db: Db, userId: string): Promise<void> {
  await db.unitOfWork.run(async (tx) => {
    await tx.topicTag.deleteMany({
      where: { OR: [{ tag: { userId } }, { topic: { subject: { userId } } }] },
    });
    await tx.competencySnapshot.deleteMany({ where: { topic: { subject: { userId } } } });
    await tx.studySession.deleteMany({ where: { userId } });
    await tx.reviewSchedule.deleteMany({ where: { topic: { subject: { userId } } } });
    await tx.topic.deleteMany({ where: { subject: { userId } } });
    await tx.tag.deleteMany({ where: { userId } });
    await tx.subject.deleteMany({ where: { userId } });
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.userSettings.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });
}

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

    // Topic.parentId is a self-referential FK (onDelete: Restrict) — delete deepest-first so a
    // child is never left pointing at an already-deleted parent mid-batch (P4 introduced real
    // multi-level topic trees, making this a live case rather than a theoretical one).
    const topics = await tx.topic.findMany({ where: { subject: { userId } } });
    const depthsDeepestFirst = [...new Set(topics.map((t) => t.depth))].sort((a, b) => b - a);
    for (const depth of depthsDeepestFirst) {
      const idsAtDepth = topics.filter((t) => t.depth === depth).map((t) => t.id);
      await tx.topic.deleteMany({ where: { id: { in: idsAtDepth } } });
    }

    await tx.tag.deleteMany({ where: { userId } });
    await tx.subject.deleteMany({ where: { userId } });
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.userSettings.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });
}

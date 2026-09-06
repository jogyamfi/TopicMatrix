import { AppError } from '@topicmatrix/shared';
import type { Db } from './db.js';
import type { Topic } from './types.js';

export interface MoveTopicInput {
  /** `undefined` = keep current parent; `null` = move to the subject's root. */
  parentId?: string | null;
  /** Only consulted when `parentId` is omitted or `null` (moving a root topic to another subject's root). */
  subjectId?: string;
  sortOrder?: number;
}

/**
 * Re-parents a topic (optionally across subjects, FR-3.5) and/or reorders it, rewriting the
 * materialised `path`/`depth` of the topic and every descendant in one batch (delivery-plan.md
 * P4 tasks 4-5). Rejects a move onto the topic itself or any of its own descendants (FR-3.4,
 * `TOPIC_CYCLE`) before writing anything.
 */
export async function moveTopic(
  db: Db,
  userId: string,
  topicId: string,
  input: MoveTopicInput,
): Promise<Topic> {
  return db.unitOfWork.run(async (tx) => {
    const topic = await tx.topic.findFirst({ where: { id: topicId, subject: { userId } } });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }

    const newParentId = input.parentId !== undefined ? input.parentId : topic.parentId;

    let newSubjectId = topic.subjectId;
    let newParentPath = '/';
    let newDepth = 0;

    if (newParentId) {
      if (newParentId === topic.id) {
        throw new AppError('TOPIC_CYCLE', 'Cannot move a topic into itself');
      }
      const parent = await tx.topic.findFirst({ where: { id: newParentId, subject: { userId } } });
      if (!parent) {
        throw new AppError('NOT_FOUND', 'Parent topic not found');
      }
      if (parent.path.startsWith(topic.path)) {
        throw new AppError(
          'TOPIC_CYCLE',
          'Cannot move a topic into one of its own descendants',
        );
      }
      newSubjectId = parent.subjectId;
      newParentPath = parent.path;
      newDepth = parent.depth + 1;
    } else if (input.subjectId) {
      const subject = await tx.subject.findFirst({ where: { id: input.subjectId, userId } });
      if (!subject) {
        throw new AppError('NOT_FOUND', 'Subject not found');
      }
      newSubjectId = subject.id;
    }

    // Sibling-name uniqueness (FR-3.3, application-level — see prisma/model.prisma's comment).
    const sibling = await tx.topic.findFirst({
      where: {
        subjectId: newSubjectId,
        parentId: newParentId,
        nameNormalised: topic.nameNormalised,
        NOT: { id: topic.id },
      },
    });
    if (sibling) {
      throw new AppError('CONFLICT', 'A sibling topic with this name already exists');
    }

    const oldPrefix = topic.path;
    const newPath = `${newParentPath}${topic.id}/`;
    const depthDelta = newDepth - topic.depth;

    // `path: { startsWith: oldPrefix }` includes the topic itself (its own path equals the
    // prefix) as well as every descendant — one batch covers both.
    const subtree = await tx.topic.findMany({ where: { path: { startsWith: oldPrefix } } });
    for (const node of subtree) {
      const suffix = node.path.slice(oldPrefix.length);
      await tx.topic.update({
        where: { id: node.id },
        data: {
          path: `${newPath}${suffix}`,
          depth: node.depth + depthDelta,
          subjectId: newSubjectId,
          ...(node.id === topic.id
            ? {
                parentId: newParentId,
                ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
              }
            : {}),
        },
      });
    }

    return tx.topic.findFirstOrThrow({ where: { id: topic.id } });
  });
}

/**
 * Deletes a topic in one of two modes (FR-3.6):
 * - `cascade`: deletes the topic and its entire subtree (sessions/schedules/snapshots/tag
 *   associations for every affected topic).
 * - `promote`: re-parents each direct child (and its own descendants) up to the deleted topic's
 *   parent, rewriting paths/depths, then deletes only the topic itself. Leaves no orphans.
 */
export async function deleteTopic(
  db: Db,
  userId: string,
  topicId: string,
  mode: 'cascade' | 'promote',
): Promise<void> {
  await db.unitOfWork.run(async (tx) => {
    const topic = await tx.topic.findFirst({ where: { id: topicId, subject: { userId } } });
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }

    if (mode === 'promote') {
      const newParentPath = topic.parentId
        ? (await tx.topic.findFirstOrThrow({ where: { id: topic.parentId } })).path
        : '/';
      // Children take the position the deleted topic occupied — same depth it was at.
      const newParentDepth = topic.depth;
      const children = await tx.topic.findMany({ where: { parentId: topic.id } });

      for (const child of children) {
        const conflict = await tx.topic.findFirst({
          where: {
            subjectId: topic.subjectId,
            parentId: topic.parentId,
            nameNormalised: child.nameNormalised,
            NOT: { id: child.id },
          },
        });
        if (conflict) {
          throw new AppError(
            'CONFLICT',
            `Promoting "${child.name}" would collide with an existing sibling of the same name`,
          );
        }

        const oldPrefix = child.path;
        const newChildPath = `${newParentPath}${child.id}/`;
        const depthDelta = newParentDepth - child.depth;

        const subtree = await tx.topic.findMany({ where: { path: { startsWith: oldPrefix } } });
        for (const node of subtree) {
          const suffix = node.path.slice(oldPrefix.length);
          await tx.topic.update({
            where: { id: node.id },
            data: {
              path: `${newChildPath}${suffix}`,
              depth: node.depth + depthDelta,
              ...(node.id === child.id ? { parentId: topic.parentId } : {}),
            },
          });
        }
      }
    }

    // cascade: everything still under the topic's own path prefix (the whole subtree).
    // promote: only the topic itself — its children were already rewritten out from under it.
    const remaining = await tx.topic.findMany({ where: { path: { startsWith: topic.path } } });
    const idsToDelete = remaining.map((t) => t.id);

    await tx.topicTag.deleteMany({ where: { topicId: { in: idsToDelete } } });
    await tx.competencySnapshot.deleteMany({ where: { topicId: { in: idsToDelete } } });
    await tx.studySession.deleteMany({ where: { topicId: { in: idsToDelete } } });
    await tx.reviewSchedule.deleteMany({ where: { topicId: { in: idsToDelete } } });

    // Topic.parentId is a self-referential FK (onDelete: Restrict) — delete deepest-first so a
    // child is never left pointing at an already-deleted parent mid-batch.
    const depthsDeepestFirst = [...new Set(remaining.map((t) => t.depth))].sort((a, b) => b - a);
    for (const depth of depthsDeepestFirst) {
      const idsAtDepth = remaining.filter((t) => t.depth === depth).map((t) => t.id);
      await tx.topic.deleteMany({ where: { id: { in: idsAtDepth } } });
    }
  });
}

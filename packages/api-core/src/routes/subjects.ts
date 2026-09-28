import type { Hono } from 'hono';
import {
  AppError,
  createSubjectRequestSchema,
  updateSubjectRequestSchema,
  deleteSubjectRequestSchema,
} from '@topicmatrix/shared';
import {
  deleteSubjectCascade,
  updateSubjectAndReschedule,
  computeSubjectTopicMetrics,
  computeSubjectSummaries,
  type Subject,
} from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';
import { buildTopicTree, MAX_TREE_NODES } from './topic-tree-view.js';

function toSubjectView(subject: Subject) {
  return {
    id: subject.id,
    name: subject.name,
    description: subject.description,
    colour: subject.colour,
    icon: subject.icon,
    sortOrder: subject.sortOrder,
    isArchived: subject.isArchived,
    defaultAlgorithm: subject.defaultAlgorithm,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  };
}

/** exactOptionalPropertyTypes rejects `{ name: undefined }` — see admin-users.ts's identical helper. */
function withoutUndefined<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  const result = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    if (value !== undefined) {
      result[key] = value as Exclude<T[typeof key], undefined>;
    }
  }
  return result;
}

/** Subjects (FR-2.*, delivery-plan.md P4). Every route is scoped to the authenticated user. */
export function registerSubjectRoutes(app: Hono<AppEnv>): void {
  app.use('/subjects', requireAuth, requirePasswordChanged);
  app.use('/subjects/*', requireAuth, requirePasswordChanged);

  app.get('/subjects', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const includeArchived = c.req.query('includeArchived') === 'true';
    const subjects = await deps.db.subjects.list(user.id, { includeArchived });

    // Topic count / aggregate competency / due-today / last-activity for each subject card
    // (FR-2.5, P7 task 1) — one bulk pass over all the subjects (R5, NF-1).
    const summaries = await computeSubjectSummaries(deps.db, user.id, subjects, deps.clock());
    return c.json({
      subjects: subjects.map((subject) => ({ ...toSubjectView(subject), summary: summaries.get(subject.id) })),
    });
  });

  app.post('/subjects', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, createSubjectRequestSchema);
    const subject = await deps.db.subjects.create(user.id, withoutUndefined(body));
    return c.json({ subject: toSubjectView(subject) }, 201);
  });

  app.get('/subjects/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const subject = await deps.db.subjects.findById(user.id, c.req.param('id'));
    if (!subject) {
      throw new AppError('NOT_FOUND', 'Subject not found');
    }
    return c.json({ subject: toSubjectView(subject) });
  });

  app.patch('/subjects/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, updateSubjectRequestSchema);
    // A new default algorithm re-derives the schedules of topics without their own override
    // (FR-5.7); `schedulesChanged` counts the next-review dates that moved, for the UI to report.
    const { subject, schedulesChanged } = await updateSubjectAndReschedule(
      deps.db,
      user.id,
      c.req.param('id'),
      withoutUndefined(body),
    );
    return c.json({ subject: toSubjectView(subject), schedulesChanged });
  });

  // Cascades topics, sessions, schedules and snapshots inside one UnitOfWork (FR-2.4).
  app.delete('/subjects/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    await parseJsonBody(c, deleteSubjectRequestSchema);
    await deleteSubjectCascade(deps.db, user.id, c.req.param('id'));
    return c.json({ status: 'ok' });
  });

  // Depth- and page-limited full tree (§14.4, FR-3.7/task 7).
  app.get('/subjects/:id/tree', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const subjectId = c.req.param('id');
    const subject = await deps.db.subjects.findById(user.id, subjectId);
    if (!subject) {
      throw new AppError('NOT_FOUND', 'Subject not found');
    }

    const topics = await deps.db.topics.listBySubject(user.id, subjectId);
    if (topics.length > MAX_TREE_NODES) {
      throw new AppError(
        'BAD_REQUEST',
        `Subject has ${topics.length} topics, exceeding the ${MAX_TREE_NODES}-node tree limit`,
        { count: topics.length, maxNodes: MAX_TREE_NODES },
      );
    }

    // Score-on-read (§7.6): computed live as of now, never read back from a stored snapshot.
    const metrics = await computeSubjectTopicMetrics(deps.db, user.id, subjectId, topics, deps.clock());
    return c.json({ subject: toSubjectView(subject), tree: buildTopicTree(topics, metrics) });
  });
}

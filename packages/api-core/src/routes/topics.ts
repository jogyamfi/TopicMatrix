import type { Hono } from 'hono';
import {
  AppError,
  createTopicRequestSchema,
  updateTopicRequestSchema,
  moveTopicRequestSchema,
  deleteTopicRequestSchema,
} from '@topicmatrix/shared';
import {
  deleteTopic,
  moveTopic,
  updateTopicAndReschedule,
  computeSubjectTopicMetrics,
  computeTopicMetrics,
  type Topic,
  type TopicScoreMetrics,
} from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function toTopicView(topic: Topic, metrics: TopicScoreMetrics) {
  return {
    id: topic.id,
    subjectId: topic.subjectId,
    parentId: topic.parentId,
    name: topic.name,
    notes: topic.notes,
    sortOrder: topic.sortOrder,
    depth: topic.depth,
    algorithmOverride: topic.algorithmOverride,
    isSuspended: topic.isSuspended,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
    metrics,
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

const TOPIC_SEARCH_LIMIT = 20;

/**
 * Topics (FR-3.*, delivery-plan.md P4). Every route is scoped to the authenticated user via
 * the subject-ownership join baked into every TopicRepository method.
 */
export function registerTopicRoutes(app: Hono<AppEnv>): void {
  app.use('/topics', requireAuth, requirePasswordChanged);
  app.use('/topics/*', requireAuth, requirePasswordChanged);

  app.get('/topics', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const subjectId = c.req.query('subjectId');
    if (!subjectId) {
      throw new AppError('BAD_REQUEST', 'subjectId query parameter is required');
    }
    const topics = await deps.db.topics.listBySubject(user.id, subjectId);
    const metrics = await computeSubjectTopicMetrics(deps.db, user.id, subjectId, topics, deps.clock());
    return c.json({
      topics: topics.map((topic) => {
        const topicMetrics = metrics.get(topic.id);
        if (!topicMetrics) {
          throw new AppError('INTERNAL_ERROR', `Missing computed metrics for topic ${topic.id}`);
        }
        return toTopicView(topic, topicMetrics);
      }),
    });
  });

  // Jump-to and topic pickers across every subject (R4, U-11). Registered before `/topics/:id`
  // so "search" isn't taken for an id.
  app.get('/topics/search', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const query = (c.req.query('q') ?? '').trim();
    if (query.length === 0) {
      return c.json({ topics: [] });
    }
    const matches = await deps.db.topics.search(user.id, query.slice(0, 120), TOPIC_SEARCH_LIMIT);

    // Ancestor names for disambiguation ("Algebra › Quadratics"), from the materialised paths —
    // one lookup for every ancestor of every match.
    const ancestorIdsOf = (path: string) => path.split('/').filter(Boolean).slice(0, -1);
    const ancestorIds = [...new Set(matches.flatMap((t) => ancestorIdsOf(t.path)))];
    const ancestors = ancestorIds.length > 0 ? await deps.db.topics.findManyByIds(user.id, ancestorIds) : [];
    const nameById = new Map(ancestors.map((t) => [t.id, t.name]));

    return c.json({
      topics: matches.map((t) => ({
        id: t.id,
        subjectId: t.subjectId,
        subjectName: t.subject.name,
        name: t.name,
        ancestors: ancestorIdsOf(t.path).map((id) => nameById.get(id) ?? '…'),
      })),
    });
  });

  app.post('/topics', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, createTopicRequestSchema);
    const topic = await deps.db.topics.create(user.id, withoutUndefined(body));
    const metrics = await computeTopicMetrics(deps.db, user.id, topic.id, deps.clock());
    return c.json({ topic: toTopicView(topic, metrics) }, 201);
  });

  app.get('/topics/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topic = await deps.db.topics.findById(user.id, c.req.param('id'));
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    const metrics = await computeTopicMetrics(deps.db, user.id, topic.id, deps.clock());
    return c.json({ topic: toTopicView(topic, metrics) });
  });

  app.patch('/topics/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, updateTopicRequestSchema);
    // Changing the algorithm re-derives the schedule from history (FR-5.7), in the same
    // transaction — the response tells the UI whether nextReviewOn actually moved, so it can
    // warn the user.
    const { topic, scheduleChanged } = await updateTopicAndReschedule(
      deps.db,
      user.id,
      c.req.param('id'),
      withoutUndefined(body),
    );

    const metrics = await computeTopicMetrics(deps.db, user.id, topic.id, deps.clock());
    return c.json({ topic: toTopicView(topic, metrics), scheduleChanged });
  });

  // cascade vs promote (FR-3.6).
  app.delete('/topics/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, deleteTopicRequestSchema);
    await deleteTopic(deps.db, user.id, c.req.param('id'), body.mode);
    return c.json({ status: 'ok' });
  });

  // Re-parent (including across subjects, FR-3.5) and/or reorder to a position among the
  // siblings; rejects cycles with TOPIC_CYCLE (FR-3.4).
  app.post('/topics/:id/move', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, moveTopicRequestSchema);
    const topic = await moveTopic(deps.db, user.id, c.req.param('id'), withoutUndefined(body));
    const metrics = await computeTopicMetrics(deps.db, user.id, topic.id, deps.clock());
    return c.json({ topic: toTopicView(topic, metrics) });
  });
}

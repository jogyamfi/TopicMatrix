import type { Hono } from 'hono';
import {
  AppError,
  createTopicRequestSchema,
  updateTopicRequestSchema,
  moveTopicRequestSchema,
  deleteTopicRequestSchema,
} from '@topicmatrix/shared';
import { deleteTopic, moveTopic, type Topic } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';
import { placeholderTopicMetrics } from './topic-tree-view.js';

function toTopicView(topic: Topic) {
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
    metrics: placeholderTopicMetrics(),
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
    return c.json({ topics: topics.map(toTopicView) });
  });

  app.post('/topics', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, createTopicRequestSchema);
    const topic = await deps.db.topics.create(user.id, withoutUndefined(body));
    return c.json({ topic: toTopicView(topic) }, 201);
  });

  app.get('/topics/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topic = await deps.db.topics.findById(user.id, c.req.param('id'));
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    return c.json({ topic: toTopicView(topic) });
  });

  app.patch('/topics/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, updateTopicRequestSchema);
    const topic = await deps.db.topics.update(user.id, c.req.param('id'), withoutUndefined(body));
    return c.json({ topic: toTopicView(topic) });
  });

  // cascade vs promote (FR-3.6).
  app.delete('/topics/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, deleteTopicRequestSchema);
    await deleteTopic(deps.db, user.id, c.req.param('id'), body.mode);
    return c.json({ status: 'ok' });
  });

  // Re-parent (including across subjects, FR-3.5) and/or reorder; rejects cycles with TOPIC_CYCLE (FR-3.4).
  app.post('/topics/:id/move', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, moveTopicRequestSchema);
    const topic = await moveTopic(deps.db, user.id, c.req.param('id'), withoutUndefined(body));
    return c.json({ topic: toTopicView(topic) });
  });
}

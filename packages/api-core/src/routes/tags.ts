import type { Hono } from 'hono';
import { createTagRequestSchema } from '@topicmatrix/shared';
import type { Tag, Topic } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';
import { placeholderTopicMetrics } from './topic-tree-view.js';

function toTagView(tag: Tag) {
  return { id: tag.id, name: tag.name, createdAt: tag.createdAt };
}

function toTopicSummaryView(topic: Topic) {
  return {
    id: topic.id,
    subjectId: topic.subjectId,
    parentId: topic.parentId,
    name: topic.name,
    depth: topic.depth,
    metrics: placeholderTopicMetrics(),
  };
}

/**
 * Tags (FR-3.9, delivery-plan.md P4 task 9). Attach/detach routes live under `/topics/:id/tags`
 * — already covered by topics.ts's `/topics/*` auth middleware, registered on the same app.
 */
export function registerTagRoutes(app: Hono<AppEnv>): void {
  app.use('/tags', requireAuth, requirePasswordChanged);
  app.use('/tags/*', requireAuth, requirePasswordChanged);

  app.get('/tags', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const tags = await deps.db.tags.list(user.id);
    return c.json({ tags: tags.map(toTagView) });
  });

  app.post('/tags', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, createTagRequestSchema);
    const tag = await deps.db.tags.create(user.id, body.name);
    return c.json({ tag: toTagView(tag) }, 201);
  });

  app.delete('/tags/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    await deps.db.tags.delete(user.id, c.req.param('id'));
    return c.json({ status: 'ok' });
  });

  // Cross-subject filter (FR-3.9): every topic, in any subject, carrying this tag.
  app.get('/tags/:id/topics', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topics = await deps.db.tags.topicsForTag(user.id, c.req.param('id'));
    return c.json({ topics: topics.map(toTopicSummaryView) });
  });

  app.get('/topics/:id/tags', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const tags = await deps.db.tags.listForTopic(user.id, c.req.param('id'));
    return c.json({ tags: tags.map(toTagView) });
  });

  app.post('/topics/:id/tags/:tagId', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    await deps.db.tags.attachToTopic(user.id, c.req.param('id'), c.req.param('tagId'));
    return c.json({ status: 'ok' });
  });

  app.delete('/topics/:id/tags/:tagId', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    await deps.db.tags.detachFromTopic(user.id, c.req.param('id'), c.req.param('tagId'));
    return c.json({ status: 'ok' });
  });
}

import type { Hono } from 'hono';
import { createTagRequestSchema, renameTagRequestSchema } from '@topicmatrix/shared';
import { computeTopicHealthView, deleteTag, type Tag } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function toTagView(tag: Tag) {
  return { id: tag.id, name: tag.name, createdAt: tag.createdAt };
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

  app.patch('/tags/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, renameTagRequestSchema);
    const tag = await deps.db.tags.rename(user.id, c.req.param('id'), body.name);
    return c.json({ tag: toTagView(tag) });
  });

  // Removes the tag's topic attachments too (the tagged topics themselves are untouched).
  app.delete('/tags/:id', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    await deleteTag(deps.db, user.id, c.req.param('id'));
    return c.json({ status: 'ok' });
  });

  // Cross-subject filter (FR-3.9): every topic, in any subject, carrying this tag.
  app.get('/tags/:id/topics', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const tagged = new Set((await deps.db.tags.topicsForTag(user.id, c.req.param('id'))).map((t) => t.id));
    // Live score/health from the Topic Health View's computation (FR-7.6), filtered to the tag.
    // Topics in archived subjects are left out, as they are everywhere else in the app.
    const rows = (await computeTopicHealthView(deps.db, user.id, deps.clock())).filter((row) =>
      tagged.has(row.topicId),
    );
    return c.json({
      topics: rows.map((row) => ({
        id: row.topicId,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        name: row.name,
        score: row.score,
        healthStatus: row.healthStatus,
        nextReviewOn: row.nextReviewOn,
      })),
    });
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

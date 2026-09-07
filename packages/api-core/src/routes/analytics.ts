import type { Context, Hono } from 'hono';
import { AppError, dateOnlySchema } from '@topicmatrix/shared';
import {
  computeDashboardAnalytics,
  computeMastery,
  computeHeatmap,
  computeTopicHealthView,
  computeRetentionSeries,
  computeAccuracyConfidenceSeries,
} from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function parseOptionalDateQuery(c: Context<AppEnv>, key: string): Date | undefined {
  const raw = c.req.query(key);
  if (!raw) {
    return undefined;
  }
  const result = dateOnlySchema.safeParse(raw);
  if (!result.success) {
    throw new AppError('BAD_REQUEST', `${key} must be an ISO date (YYYY-MM-DD)`);
  }
  return result.data;
}

function requireQueryParam(c: Context<AppEnv>, key: string): string {
  const value = c.req.query(key);
  if (!value) {
    throw new AppError('BAD_REQUEST', `${key} query parameter is required`);
  }
  return value;
}

/** `{ topicId }` or `{ subjectId }` from query params \u2014 exactly one is required (FR-7.7, FR-7.8). */
function requireTopicOrSubjectTarget(
  c: Context<AppEnv>,
): { topicId: string } | { subjectId: string } {
  const topicId = c.req.query('topicId');
  const subjectId = c.req.query('subjectId');
  if (topicId && subjectId) {
    throw new AppError('BAD_REQUEST', 'Provide either topicId or subjectId, not both');
  }
  if (topicId) {
    return { topicId };
  }
  if (subjectId) {
    return { subjectId };
  }
  throw new AppError('BAD_REQUEST', 'Either topicId or subjectId query parameter is required');
}

/**
 * Dashboard & analytics (FR-7.*, delivery-plan.md P9). Every route scopes reads to the
 * authenticated user via the same repository ownership checks every other route relies on; a
 * `topicId`/`subjectId` supplied here is additionally verified to exist and be owned before use,
 * so an unowned id 404s rather than silently returning an empty series.
 */
export function registerAnalyticsRoutes(app: Hono<AppEnv>): void {
  app.use('/analytics/*', requireAuth, requirePasswordChanged);

  app.get('/analytics/dashboard', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const analytics = await computeDashboardAnalytics(deps.db, user.id, deps.clock());
    return c.json(analytics);
  });

  app.get('/analytics/mastery', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const subjectId = requireQueryParam(c, 'subjectId');
    const subject = await deps.db.subjects.findById(user.id, subjectId);
    if (!subject) {
      throw new AppError('NOT_FOUND', 'Subject not found');
    }
    const topics = await computeMastery(deps.db, user.id, subjectId, deps.clock());
    return c.json({ topics });
  });

  app.get('/analytics/heatmap', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const subjectId = requireQueryParam(c, 'subjectId');
    const subject = await deps.db.subjects.findById(user.id, subjectId);
    if (!subject) {
      throw new AppError('NOT_FOUND', 'Subject not found');
    }
    const topics = await computeHeatmap(deps.db, user.id, subjectId, deps.clock());
    return c.json({ topics });
  });

  // Cross-subject by default (FR-7.6's "every topic"); an optional subjectId narrows it, same
  // convention as /review/queue's implicit "every subject" scope.
  app.get('/analytics/health', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const subjectId = c.req.query('subjectId');
    if (subjectId) {
      const subject = await deps.db.subjects.findById(user.id, subjectId);
      if (!subject) {
        throw new AppError('NOT_FOUND', 'Subject not found');
      }
    }
    const topics = await computeTopicHealthView(deps.db, user.id, deps.clock(), {
      ...(subjectId ? { subjectId } : {}),
    });
    return c.json({ topics });
  });

  app.get('/analytics/retention', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const target = requireTopicOrSubjectTarget(c);
    if ('topicId' in target) {
      const topic = await deps.db.topics.findById(user.id, target.topicId);
      if (!topic) {
        throw new AppError('NOT_FOUND', 'Topic not found');
      }
    } else {
      const subject = await deps.db.subjects.findById(user.id, target.subjectId);
      if (!subject) {
        throw new AppError('NOT_FOUND', 'Subject not found');
      }
    }
    const from = parseOptionalDateQuery(c, 'from');
    const to = parseOptionalDateQuery(c, 'to');
    const series = await computeRetentionSeries(
      deps.db,
      user.id,
      target,
      { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      deps.clock(),
    );
    return c.json(series);
  });

  app.get('/analytics/accuracy-confidence', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const target = requireTopicOrSubjectTarget(c);
    if ('topicId' in target) {
      const topic = await deps.db.topics.findById(user.id, target.topicId);
      if (!topic) {
        throw new AppError('NOT_FOUND', 'Topic not found');
      }
    } else {
      const subject = await deps.db.subjects.findById(user.id, target.subjectId);
      if (!subject) {
        throw new AppError('NOT_FOUND', 'Subject not found');
      }
    }
    const from = parseOptionalDateQuery(c, 'from');
    const to = parseOptionalDateQuery(c, 'to');
    const points = await computeAccuracyConfidenceSeries(deps.db, user.id, target, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return c.json({ points });
  });
}

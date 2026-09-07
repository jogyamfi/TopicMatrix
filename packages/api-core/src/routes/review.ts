import type { Hono } from 'hono';
import { AppError, reviewStartRequestSchema } from '@topicmatrix/shared';
import { buildReviewSession, computeReviewQueue, type ReviewQueueItem, type ReviewSessionMode } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function toItemView(item: ReviewQueueItem) {
  return {
    topicId: item.topicId,
    subjectId: item.subjectId,
    subjectName: item.subjectName,
    name: item.name,
    notes: item.notes,
    score: item.score,
    healthStatus: item.healthStatus,
    lastReviewedOn: item.lastReviewedOn,
    nextReviewOn: item.nextReviewOn,
    overdueDays: item.overdueDays,
    accuracyTrend: item.accuracyTrend,
  };
}

/**
 * Runtime-guaranteed by reviewStartRequestSchema's per-mode `.refine`, but not encoded in the
 * flat schema's inferred type (every field is independently optional there) \u2014 makes that
 * guarantee explicit instead of a bare `!` assertion.
 */
function requireField<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined) {
    throw new AppError('VALIDATION_FAILED', `${fieldName} is required`);
  }
  return value;
}

/**
 * Review queue & study session launcher (FR-6.*, FR-7.1, delivery-plan.md P8) \u2014 "what should I
 * revise today?", the product's core value proposition.
 */
export function registerReviewRoutes(app: Hono<AppEnv>): void {
  app.get('/review/queue', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const buckets = await computeReviewQueue(deps.db, user.id, deps.clock());
    return c.json({
      overdue: buckets.overdue.map(toItemView),
      dueToday: buckets.dueToday.map(toItemView),
      dueNext7Days: buckets.dueNext7Days.map(toItemView),
    });
  });

  app.post('/review/start', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, reviewStartRequestSchema);

    const mode: ReviewSessionMode =
      body.mode === 'subject'
        ? { kind: 'subject', subjectId: requireField(body.subjectId, 'subjectId') }
        : body.mode === 'topicSubtree'
          ? { kind: 'topicSubtree', topicId: requireField(body.topicId, 'topicId') }
          : body.mode === 'dueToday'
            ? { kind: 'dueToday' }
            : { kind: 'weakest' };

    const items = await buildReviewSession(
      deps.db,
      user.id,
      mode,
      {
        ...(body.tagId !== undefined ? { tagId: body.tagId } : {}),
        ...(body.healthStatus !== undefined ? { healthStatus: body.healthStatus } : {}),
        ...(body.notReviewedInDays !== undefined ? { notReviewedInDays: body.notReviewedInDays } : {}),
        ...(body.minScore !== undefined ? { minScore: body.minScore } : {}),
        ...(body.maxScore !== undefined ? { maxScore: body.maxScore } : {}),
      },
      {
        ...(body.maxItems !== undefined ? { maxItems: body.maxItems } : {}),
        ...(body.targetMinutes !== undefined ? { targetMinutes: body.targetMinutes } : {}),
      },
      deps.clock(),
    );

    return c.json({ items: items.map(toItemView) });
  });
}

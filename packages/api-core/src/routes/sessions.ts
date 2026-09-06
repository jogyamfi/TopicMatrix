import type { Context, Hono } from 'hono';
import {
  AppError,
  createStudySessionRequestSchema,
  updateStudySessionRequestSchema,
  sessionPreviewRequestSchema,
  scheduleOverrideRequestSchema,
  dateOnlySchema,
  startOfUserDay,
} from '@topicmatrix/shared';
import { computeGrade } from '@topicmatrix/core';
import {
  recalculateTopicSchedule,
  applyScheduleOverride,
  type ScheduleOverride,
  type StudySession,
  type ReviewSchedule,
  type CompetencySnapshot,
} from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function toSessionView(session: StudySession) {
  return {
    id: session.id,
    topicId: session.topicId,
    studiedOn: session.studiedOn,
    sourceLabel: session.sourceLabel,
    questionsAttempted: session.questionsAttempted,
    questionsCorrect: session.questionsCorrect,
    accuracy: session.accuracy,
    confidence: session.confidence,
    durationMinutes: session.durationMinutes,
    notes: session.notes,
    gradeUsed: session.gradeUsed,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function toScheduleView(schedule: ReviewSchedule | null) {
  if (!schedule) {
    return null;
  }
  return {
    topicId: schedule.topicId,
    algorithm: schedule.algorithm,
    lastReviewedOn: schedule.lastReviewedOn,
    nextReviewOn: schedule.nextReviewOn,
    intervalDays: schedule.intervalDays,
    repetitions: schedule.repetitions,
    lapses: schedule.lapses,
    easeFactor: schedule.easeFactor,
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    manualLadderIndex: schedule.manualLadderIndex,
    isSuspended: schedule.isSuspended,
  };
}

function toSnapshotView(snapshot: CompetencySnapshot) {
  return {
    id: snapshot.id,
    topicId: snapshot.topicId,
    capturedOn: snapshot.capturedOn,
    score: snapshot.score,
    accuracyComponent: snapshot.accuracyComponent,
    confidenceComponent: snapshot.confidenceComponent,
    recencyComponent: snapshot.recencyComponent,
    triggeredBySessionId: snapshot.triggeredBySessionId,
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

/**
 * Study sessions, scoring and scheduling integration (FR-4.*, FR-5.*, delivery-plan.md P5).
 * Every session write triggers a full replay-based recalculation of the topic's schedule and a
 * new competency snapshot (`recalculateTopicSchedule`, §8.6/FR-7.10) — never an incremental patch.
 */
export function registerSessionRoutes(app: Hono<AppEnv>): void {
  app.get('/topics/:id/sessions', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topicId = c.req.param('id');
    const topic = await deps.db.topics.findById(user.id, topicId);
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    const sessions = await deps.db.studySessions.listByTopic(user.id, topicId);
    return c.json({ sessions: sessions.map(toSessionView) });
  });

  // studiedOn defaults to the user's current day when omitted, honouring dayStartHour (FR-5.9):
  // logged at 01:00 local with dayStartHour = 4, "today" is still yesterday's calendar date.
  app.post('/topics/:id/sessions', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topicId = c.req.param('id');
    const body = await parseJsonBody(c, createStudySessionRequestSchema);

    const settings = await deps.db.userSettings.find(user.id);
    if (!settings) {
      throw new AppError('NOT_FOUND', 'User settings not found');
    }
    const now = deps.clock();
    const today = startOfUserDay(now, settings.timezone, settings.dayStartHour);
    const studiedOn = body.studiedOn ?? today;
    if (studiedOn.getTime() > today.getTime()) {
      throw new AppError('VALIDATION_FAILED', 'studiedOn cannot be in the future', {
        studiedOn: 'in the future',
      });
    }

    const session = await deps.db.studySessions.create(user.id, {
      topicId,
      studiedOn,
      questionsAttempted: body.questionsAttempted,
      questionsCorrect: body.questionsCorrect,
      confidence: body.confidence,
      ...withoutUndefined({
        sourceLabel: body.sourceLabel,
        durationMinutes: body.durationMinutes,
        notes: body.notes,
        gradeUsed: body.gradeUsed,
      }),
    });

    const recalculation = await recalculateTopicSchedule(deps.db, user.id, topicId, {
      asOfDate: now,
      triggeredBySessionId: session.id,
    });

    return c.json(
      { session: toSessionView(session), schedule: toScheduleView(recalculation.schedule) },
      201,
    );
  });

  // The grade the mapping would produce, before save — the UI shows this with an override
  // control (FR-5.4); the value actually used is only persisted once the session is created.
  app.post('/topics/:id/sessions/preview', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topic = await deps.db.topics.findById(user.id, c.req.param('id'));
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }
    const body = await parseJsonBody(c, sessionPreviewRequestSchema);
    const accuracy = body.questionsCorrect / body.questionsAttempted;
    const grade = computeGrade(accuracy, body.confidence);
    return c.json({ accuracy, grade });
  });

  app.patch('/sessions/:id', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const sessionId = c.req.param('id');
    const body = await parseJsonBody(c, updateStudySessionRequestSchema);

    const existing = await deps.db.studySessions.findById(user.id, sessionId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Study session not found');
    }

    if (body.studiedOn !== undefined) {
      const settings = await deps.db.userSettings.find(user.id);
      if (!settings) {
        throw new AppError('NOT_FOUND', 'User settings not found');
      }
      const today = startOfUserDay(deps.clock(), settings.timezone, settings.dayStartHour);
      if (body.studiedOn.getTime() > today.getTime()) {
        throw new AppError('VALIDATION_FAILED', 'studiedOn cannot be in the future', {
          studiedOn: 'in the future',
        });
      }
    }

    const session = await deps.db.studySessions.update(user.id, sessionId, withoutUndefined(body));
    const recalculation = await recalculateTopicSchedule(deps.db, user.id, existing.topicId, {
      asOfDate: deps.clock(),
      triggeredBySessionId: session.id,
    });

    return c.json({ session: toSessionView(session), schedule: toScheduleView(recalculation.schedule) });
  });

  app.delete('/sessions/:id', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const sessionId = c.req.param('id');

    const existing = await deps.db.studySessions.findById(user.id, sessionId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Study session not found');
    }

    await deps.db.studySessions.delete(user.id, sessionId);
    const recalculation = await recalculateTopicSchedule(deps.db, user.id, existing.topicId, {
      asOfDate: deps.clock(),
    });

    return c.json({ status: 'ok', schedule: toScheduleView(recalculation.schedule) });
  });

  // Snapshot history for the retention curve, date-range filterable (FR-7.7's data source).
  app.get('/topics/:id/history', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topicId = c.req.param('id');
    const topic = await deps.db.topics.findById(user.id, topicId);
    if (!topic) {
      throw new AppError('NOT_FOUND', 'Topic not found');
    }

    const from = parseOptionalDateQuery(c, 'from');
    const to = parseOptionalDateQuery(c, 'to');
    const snapshots = await deps.db.competencySnapshots.listByTopic(user.id, topicId, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return c.json({ snapshots: snapshots.map(toSnapshotView) });
  });

  // Explicit next-review date, snooze by n days, or suspend/unsuspend (FR-5.6, FR-5.10) —
  // independent of session history, so applied directly rather than via recalculation.
  app.post('/topics/:id/schedule/override', requireAuth, requirePasswordChanged, async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const topicId = c.req.param('id');
    const body = await parseJsonBody(c, scheduleOverrideRequestSchema);

    const override: ScheduleOverride =
      body.action === 'setNextReviewOn'
        ? { kind: 'setNextReviewOn', nextReviewOn: body.nextReviewOn }
        : body.action === 'snooze'
          ? { kind: 'snooze', days: body.days }
          : { kind: 'suspend', suspended: body.suspended };

    const schedule = await applyScheduleOverride(deps.db, user.id, topicId, override, deps.clock());
    return c.json({ schedule: toScheduleView(schedule) });
  });
}

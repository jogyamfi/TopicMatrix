import type { Hono } from 'hono';
import {
  AppError,
  parseManualIntervals,
  stringifyManualIntervals,
  updateUserSettingsRequestSchema,
  settingsPreviewRequestSchema,
  DEFAULT_MANUAL_INTERVALS,
  DEFAULT_STRONG_THRESHOLD,
  DEFAULT_NEEDS_REVIEW_THRESHOLD,
} from '@topicmatrix/shared';
import type { UpdateUserSettingsInput } from '@topicmatrix/db';
import { validateScoringWeights, DEFAULT_SCORING_WEIGHTS } from '@topicmatrix/core';
import { computeSettingsPreview } from '@topicmatrix/db';
import type { UserSettings } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { parseJsonBody } from '../validation.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function toSettingsView(settings: UserSettings) {
  return {
    timezone: settings.timezone,
    dayStartHour: settings.dayStartHour,
    defaultAlgorithm: settings.defaultAlgorithm,
    manualIntervals: parseManualIntervals(settings.manualIntervalsJson),
    neglectThresholdDays: settings.neglectThresholdDays,
    weightAccuracy: settings.weightAccuracy,
    weightConfidence: settings.weightConfidence,
    weightRecency: settings.weightRecency,
    strongThreshold: settings.strongThreshold,
    needsReviewThreshold: settings.needsReviewThreshold,
    theme: settings.theme,
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
 * Settings (FR-8.1, FR-8.2, delivery-plan.md P10). Validation always runs against the FINAL,
 * merged settings (existing row + the requested patch) rather than requiring every weight field
 * in one request — a user can PATCH a single weight and still get a correct "do the three
 * weights sum to 1.0?" check against what the row will actually look like afterward.
 */
export function registerSettingsRoutes(app: Hono<AppEnv>): void {
  app.use('/me/settings', requireAuth, requirePasswordChanged);
  app.use('/me/settings/*', requireAuth, requirePasswordChanged);

  app.get('/me/settings', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const settings = await deps.db.userSettings.find(user.id);
    if (!settings) {
      throw new AppError('NOT_FOUND', 'User settings not found');
    }
    return c.json({ settings: toSettingsView(settings) });
  });

  app.patch('/me/settings', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, updateUserSettingsRequestSchema);
    const existing = await deps.db.userSettings.find(user.id);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'User settings not found');
    }

    const merged = {
      weightAccuracy: body.weightAccuracy ?? existing.weightAccuracy,
      weightConfidence: body.weightConfidence ?? existing.weightConfidence,
      weightRecency: body.weightRecency ?? existing.weightRecency,
      strongThreshold: body.strongThreshold ?? existing.strongThreshold,
      needsReviewThreshold: body.needsReviewThreshold ?? existing.needsReviewThreshold,
    };
    validateWeightsAndThresholds(merged);

    const { manualIntervals, ...rest } = body;
    const patch: UpdateUserSettingsInput = withoutUndefined(rest);
    if (manualIntervals !== undefined) {
      patch.manualIntervalsJson = stringifyManualIntervals(manualIntervals);
    }

    const updated = await deps.db.userSettings.update(user.id, patch);
    return c.json({ settings: toSettingsView(updated) });
  });

  // Resets only the scoring-weight/threshold fields to their platform defaults (FR-8.2's
  // "reset-to-defaults") — timezone, algorithm, manual ladder etc. are left untouched.
  app.post('/me/settings/reset-scoring', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const updated = await deps.db.userSettings.update(user.id, {
      weightAccuracy: DEFAULT_SCORING_WEIGHTS.accuracy,
      weightConfidence: DEFAULT_SCORING_WEIGHTS.confidence,
      weightRecency: DEFAULT_SCORING_WEIGHTS.recency,
      strongThreshold: DEFAULT_STRONG_THRESHOLD,
      needsReviewThreshold: DEFAULT_NEEDS_REVIEW_THRESHOLD,
      manualIntervalsJson: stringifyManualIntervals([...DEFAULT_MANUAL_INTERVALS]),
    });
    return c.json({ settings: toSettingsView(updated) });
  });

  // Live preview of a proposed weight/threshold change against a sample topic (FR-8.2 task 2).
  app.post('/me/settings/preview', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const body = await parseJsonBody(c, settingsPreviewRequestSchema);
    validateWeightsAndThresholds(body);
    const preview = await computeSettingsPreview(
      deps.db,
      user.id,
      deps.clock(),
      {
        accuracy: body.weightAccuracy,
        confidence: body.weightConfidence,
        recency: body.weightRecency,
        strongThreshold: body.strongThreshold,
        needsReviewThreshold: body.needsReviewThreshold,
      },
      body.topicId,
    );
    return c.json({ preview });
  });
}

function validateWeightsAndThresholds(v: {
  weightAccuracy: number;
  weightConfidence: number;
  weightRecency: number;
  strongThreshold: number;
  needsReviewThreshold: number;
}): void {
  try {
    validateScoringWeights({ accuracy: v.weightAccuracy, confidence: v.weightConfidence, recency: v.weightRecency });
  } catch (err) {
    throw new AppError('VALIDATION_FAILED', err instanceof Error ? err.message : 'Invalid scoring weights');
  }
  if (v.needsReviewThreshold >= v.strongThreshold) {
    throw new AppError('VALIDATION_FAILED', 'needsReviewThreshold must be less than strongThreshold');
  }
}

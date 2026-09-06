import { DEFAULT_MANUAL_INTERVALS, stringifyManualIntervals } from '@topicmatrix/shared';
import type { PrismaClientOrTx, UserSettings } from '../types.js';

export interface UpdateUserSettingsInput {
  timezone?: string;
  dayStartHour?: number;
  defaultAlgorithm?: string;
  manualIntervalsJson?: string;
  neglectThresholdDays?: number;
  weightAccuracy?: number;
  weightConfidence?: number;
  weightRecency?: number;
  strongThreshold?: number;
  needsReviewThreshold?: number;
  theme?: string;
}

export interface UserSettingsRepository {
  find(userId: string): Promise<UserSettings | null>;
  /** Creates the default settings row for a new user — every user has exactly one (§6.1). */
  createDefault(userId: string): Promise<UserSettings>;
  update(userId: string, patch: UpdateUserSettingsInput): Promise<UserSettings>;
}

export function createUserSettingsRepository(client: PrismaClientOrTx): UserSettingsRepository {
  return {
    find: (userId) => client.userSettings.findUnique({ where: { userId } }),
    createDefault: (userId) =>
      client.userSettings.create({
        data: {
          userId,
          manualIntervalsJson: stringifyManualIntervals([...DEFAULT_MANUAL_INTERVALS]),
        },
      }),
    update: (userId, patch) => client.userSettings.update({ where: { userId }, data: patch }),
  };
}

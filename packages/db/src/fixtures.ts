import type { Db } from './db.js';
import type { CreateUserInput } from './repositories/user.js';
import type { CreateSubjectInput } from './repositories/subject.js';
import type { CreateTopicInput } from './repositories/topic.js';
import type { CreateStudySessionInput } from './repositories/study-session.js';
import type { Subject, Topic, User, UserSettings, StudySession } from './types.js';

/**
 * Test-data factory for users, subjects, topic trees and sessions (delivery-plan.md P1 task
 * 10) — every later phase's tests build on this rather than hand-rolling fixtures. Every value
 * defaults to something valid but unique (via a random suffix), so tests never collide with each
 * other even when run against a shared database (e.g. `test:integration:pg`).
 */
export interface Fixtures {
  createUser(overrides?: Partial<CreateUserInput>): Promise<User>;
  createUserWithSettings(overrides?: Partial<CreateUserInput>): Promise<{
    user: User;
    settings: UserSettings;
  }>;
  createSubject(userId: string, overrides?: Partial<CreateSubjectInput>): Promise<Subject>;
  createTopic(
    userId: string,
    subjectId: string,
    overrides?: Partial<Omit<CreateTopicInput, 'subjectId'>>,
  ): Promise<Topic>;
  /** Builds a linear chain of `depth` topics (root -> child -> grandchild -> ...). */
  createTopicChain(userId: string, subjectId: string, depth: number): Promise<Topic[]>;
  createStudySession(
    userId: string,
    topicId: string,
    overrides?: Partial<Omit<CreateStudySessionInput, 'topicId'>>,
  ): Promise<StudySession>;
}

function uniqueSuffix(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Strips undefined-valued keys so spreading an `overrides` object never violates `exactOptionalPropertyTypes`. */
function withoutUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function createFixtures(db: Db): Fixtures {
  const createUser: Fixtures['createUser'] = (overrides) => {
    const suffix = uniqueSuffix();
    const email = overrides?.email ?? `learner-${suffix}@example.com`;
    return db.users.create({
      email,
      emailNormalised: email.toLowerCase(),
      passwordHash: 'test-hash-not-a-real-password-hash',
      displayName: `Test Learner ${suffix}`,
      ...withoutUndefined(overrides ?? {}),
    });
  };

  const createTopic: Fixtures['createTopic'] = (userId, subjectId, overrides) => {
    const suffix = uniqueSuffix();
    return db.topics.create(userId, {
      subjectId,
      name: `Test Topic ${suffix}`,
      ...withoutUndefined(overrides ?? {}),
    });
  };

  return {
    createUser,

    createUserWithSettings: async (overrides) => {
      const user = await createUser(overrides);
      const settings = await db.userSettings.createDefault(user.id);
      return { user, settings };
    },

    createSubject: (userId, overrides) => {
      const suffix = uniqueSuffix();
      return db.subjects.create(userId, {
        name: `Test Subject ${suffix}`,
        ...withoutUndefined(overrides ?? {}),
      });
    },

    createTopic,

    createTopicChain: async (userId, subjectId, depth) => {
      const topics: Topic[] = [];
      let parentId: string | undefined;
      for (let i = 0; i < depth; i += 1) {
        const topic = await createTopic(userId, subjectId, parentId ? { parentId } : {});
        topics.push(topic);
        parentId = topic.id;
      }
      return topics;
    },

    createStudySession: (userId, topicId, overrides) =>
      db.studySessions.create(userId, {
        topicId,
        studiedOn: new Date(),
        questionsAttempted: 10,
        questionsCorrect: 7,
        confidence: 3,
        ...withoutUndefined(overrides ?? {}),
      }),
  };
}

// One-time-or-repeatable demo dataset seeder (FR-D.10): several subjects, a multi-level topic
// tree, and back-dated sessions producing a non-empty review queue and a short retention
// history — so P8/P9 (queue/analytics) work doesn't need hand-entered data. Node-only, like
// seed-admin.ts, and never intended for production use (the password hash below is a placeholder).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseConfig } from '@topicmatrix/shared';
import { createDb, type Db } from '@topicmatrix/db';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const DEMO_EMAIL = 'demo@example.com';

interface TopicSeed {
  name: string;
  children?: TopicSeed[];
}

interface SubjectSeed {
  name: string;
  colour: string;
  topics: TopicSeed[];
}

const SUBJECTS: SubjectSeed[] = [
  {
    name: 'Mathematics',
    colour: '#2563eb',
    topics: [
      {
        name: 'Algebra',
        children: [{ name: 'Quadratic equations' }, { name: 'Simultaneous equations' }],
      },
      { name: 'Calculus', children: [{ name: 'Differentiation' }, { name: 'Integration' }] },
    ],
  },
  {
    name: 'Physics',
    colour: '#059669',
    topics: [
      { name: 'Mechanics', children: [{ name: 'Forces' }, { name: 'Momentum' }] },
      { name: 'Electricity', children: [{ name: 'Circuits' }] },
    ],
  },
  {
    name: 'Chemistry',
    colour: '#d97706',
    topics: [
      { name: 'Organic Chemistry', children: [{ name: 'Alkanes and alkenes' }] },
      { name: 'Periodicity' },
    ],
  },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  return daysAgo(-n);
}

function pick<T>(items: T[], seed: number): T {
  const item = items[Math.abs(seed) % items.length];
  if (item === undefined) {
    throw new Error('pick() called with an empty array');
  }
  return item;
}

async function seedTopic(
  db: Db,
  userId: string,
  subjectId: string,
  seed: TopicSeed,
  parentId: string | null,
  counter: number,
): Promise<void> {
  const topic = await db.topics.create(userId, {
    subjectId,
    ...(parentId ? { parentId } : {}),
    name: seed.name,
  });

  const sessionCount = 3 + (counter % 4);
  let lastStudiedOn = daysAgo(0);
  for (let i = sessionCount; i > 0; i -= 1) {
    const studiedOn = daysAgo(i * 5 + (counter % 3));
    lastStudiedOn = studiedOn;
    const attempted = 8 + (counter % 5);
    const correct = Math.max(1, attempted - (i % 4));
    const confidence = 1 + ((counter + i) % 5);

    await db.studySessions.create(userId, {
      topicId: topic.id,
      studiedOn,
      questionsAttempted: attempted,
      questionsCorrect: correct,
      confidence,
      sourceLabel: pick(['Past paper', 'Textbook', 'Question bank'], counter + i),
    });

    await db.competencySnapshots.create(userId, topic.id, {
      capturedOn: studiedOn,
      score: 40 + ((counter * 7 + i * 11) % 55),
      accuracyComponent: correct / attempted,
      confidenceComponent: (confidence - 1) / 4,
      recencyComponent: 0.5,
    });
  }

  // Spread schedules across overdue / due today / due soon / future so the queue (P8) is never
  // trivially empty (FR-D.10).
  const bucket = counter % 4;
  const nextReviewOn =
    bucket === 0
      ? daysAgo(3)
      : bucket === 1
        ? daysAgo(0)
        : bucket === 2
          ? daysFromNow(3)
          : daysFromNow(14);

  await db.reviewSchedules.upsert(userId, topic.id, {
    algorithm: 'fsrs',
    lastReviewedOn: lastStudiedOn,
    nextReviewOn,
    intervalDays: bucket === 3 ? 14 : 7,
    repetitions: sessionCount,
  });

  for (const child of seed.children ?? []) {
    await seedTopic(db, userId, subjectId, child, topic.id, counter + 1);
  }
}

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const db = createDb(config);

  try {
    const existing = await db.users.findByEmailNormalised(DEMO_EMAIL);
    const user =
      existing ??
      (await db.users.create({
        email: DEMO_EMAIL,
        emailNormalised: DEMO_EMAIL,
        passwordHash: 'seed-demo-not-a-real-password-hash',
        displayName: 'Demo Learner',
      }));

    if (!(await db.userSettings.find(user.id))) {
      await db.userSettings.createDefault(user.id);
    }

    let topicCounter = 0;
    for (const [subjectIndex, subjectSeed] of SUBJECTS.entries()) {
      const subject =
        (await db.subjects.list(user.id)).find((s) => s.name === subjectSeed.name) ??
        (await db.subjects.create(user.id, {
          name: subjectSeed.name,
          colour: subjectSeed.colour,
          sortOrder: subjectIndex,
        }));

      for (const topicSeed of subjectSeed.topics) {
        await seedTopic(db, user.id, subject.id, topicSeed, null, topicCounter);
        topicCounter += 1;
      }
    }

    console.log(
      JSON.stringify({
        level: 'info',
        message: 'seed:demo complete',
        user: DEMO_EMAIL,
        subjects: SUBJECTS.length,
      }),
    );
  } finally {
    await db.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({ level: 'error', message: 'seed:demo failed', error: String(err) }),
  );
  process.exitCode = 1;
});

// NF-1 performance dataset (R5): one user with 20 subjects x 100 topics (10 roots x 9 children)
// and 20,000 sessions (10 per topic) spread over the past year, with schedules and snapshots
// derived exactly as real session writes derive them. Point DATABASE_URL at a scratch database —
// this is for measuring (`npm run perf:measure`), not for demoing.
//
//   DATABASE_PROVIDER=sqlite DATABASE_URL=file:./perf.db npm run db:migrate   (or migrate deploy)
//   DATABASE_PROVIDER=sqlite DATABASE_URL=file:./perf.db npm run seed:perf -w apps/api
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseConfig } from '@topicmatrix/shared';
import { createUserWithDefaultSettings, recalculateTopicSchedule } from '@topicmatrix/db';
import { createNodeDb } from '@topicmatrix/db/node';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const PERF_EMAIL = 'perf@example.com';
const SUBJECTS = 20;
const ROOTS_PER_SUBJECT = 10;
const CHILDREN_PER_ROOT = 9;
const SESSIONS_PER_TOPIC = 10;

function utcDaysAgo(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const db = createNodeDb(config);
  const started = Date.now();
  try {
    if (await db.users.findByEmailNormalised(PERF_EMAIL)) {
      console.log(JSON.stringify({ level: 'error', message: 'seed:perf refused: the perf user already exists' }));
      process.exitCode = 1;
      return;
    }
    const user = await createUserWithDefaultSettings(db, {
      email: PERF_EMAIL,
      emailNormalised: PERF_EMAIL,
      passwordHash: 'seed-perf-not-a-real-password-hash',
      displayName: 'Perf Learner',
    });

    const topicIds: string[] = [];
    for (let s = 0; s < SUBJECTS; s += 1) {
      const subject = await db.subjects.create(user.id, { name: `Subject ${s + 1}`, sortOrder: s });
      for (let r = 0; r < ROOTS_PER_SUBJECT; r += 1) {
        const root = await db.topics.create(user.id, { subjectId: subject.id, name: `Topic ${s + 1}.${r + 1}` });
        topicIds.push(root.id);
        for (let c = 0; c < CHILDREN_PER_ROOT; c += 1) {
          const child = await db.topics.create(user.id, {
            subjectId: subject.id,
            parentId: root.id,
            name: `Topic ${s + 1}.${r + 1}.${c + 1}`,
          });
          topicIds.push(child.id);
        }
      }
    }

    // Sessions in bulk (one transaction per topic batch), then one recalculation per topic so the
    // schedules and snapshot history are exactly what real writes would have produced.
    let sessionCount = 0;
    for (let t = 0; t < topicIds.length; t += 1) {
      const topicId = topicIds[t] as string;
      const data = Array.from({ length: SESSIONS_PER_TOPIC }, (_, i) => {
        const attempted = 5 + ((t + i) % 16);
        return {
          topicId,
          userId: user.id,
          studiedOn: utcDaysAgo(((t * 7 + i * 37) % 365) + 1),
          questionsAttempted: attempted,
          questionsCorrect: Math.max(0, attempted - ((t * 3 + i) % 6)),
          accuracy: 0, // replaced below
          confidence: 1 + ((t + i * 2) % 5),
          durationMinutes: 5 + ((t + i) % 25),
        };
      }).map((row) => ({ ...row, accuracy: row.questionsCorrect / row.questionsAttempted }));
      await db.unitOfWork.run((tx) => tx.studySession.createMany({ data }));
      sessionCount += data.length;
      await recalculateTopicSchedule(db, user.id, topicId);
      if ((t + 1) % 200 === 0) {
        console.log(JSON.stringify({ level: 'info', message: 'seed:perf progress', topics: t + 1 }));
      }
    }

    console.log(
      JSON.stringify({
        level: 'info',
        message: 'seed:perf complete',
        user: PERF_EMAIL,
        subjects: SUBJECTS,
        topics: topicIds.length,
        sessions: sessionCount,
        seconds: Math.round((Date.now() - started) / 1000),
      }),
    );
  } finally {
    await db.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ level: 'error', message: 'seed:perf failed', error: String(err) }));
  process.exitCode = 1;
});

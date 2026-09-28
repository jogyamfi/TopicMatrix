// NF-1 measurement (R5): times the heaviest read endpoints against the `seed:perf` dataset,
// in-process (the real Hono app and database, no network), and prints p50/p95/max per endpoint.
//
//   DATABASE_PROVIDER=sqlite DATABASE_URL=file:./perf.db npm run perf:measure -w apps/api
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  buildDeps,
  createAllowAllRateLimiter,
  createApp,
  createPasswordService,
  createTokenService,
} from '@topicmatrix/api-core';
import { createProcessDbCache } from '@topicmatrix/db/node';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const PERF_EMAIL = 'perf@example.com';
const WARMUP_RUNS = 3;
const RUNS = Number(process.env.PERF_RUNS ?? 20);

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

async function main(): Promise<void> {
  const dbCache = createProcessDbCache();
  const buildRequestDeps = () =>
    buildDeps(process.env, {
      createDb: (config) => dbCache.getDb(config),
      getClientIp: () => '127.0.0.1',
      rateLimiter: createAllowAllRateLimiter(),
      createPasswordService,
    });
  const deps = buildRequestDeps();
  const app = createApp(buildRequestDeps);

  try {
    const user = await deps.db.users.findByEmailNormalised(PERF_EMAIL);
    if (!user) {
      throw new Error(`No ${PERF_EMAIL} user — run \`npm run seed:perf -w apps/api\` against this database first.`);
    }
    const token = await createTokenService(deps.config.jwtSecret).signAccessToken({ userId: user.id, role: 'LEARNER' });
    const [firstSubject] = await deps.db.subjects.list(user.id);
    if (!firstSubject) throw new Error('The perf user has no subjects');

    const endpoints = [
      '/subjects',
      '/review/queue',
      '/analytics/health',
      `/subjects/${firstSubject.id}/tree`,
      '/analytics/dashboard',
      `/analytics/retention?subjectId=${firstSubject.id}`,
    ];

    const results = [];
    for (const endpoint of endpoints) {
      const time = async () => {
        const start = performance.now();
        const res = await app.request(endpoint, { headers: { authorization: `Bearer ${token}` } });
        await res.arrayBuffer();
        if (!res.ok) throw new Error(`${endpoint} -> ${res.status}`);
        return performance.now() - start;
      };
      for (let i = 0; i < WARMUP_RUNS; i += 1) await time();
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i += 1) samples.push(await time());
      samples.sort((a, b) => a - b);
      results.push({
        endpoint: endpoint.replace(firstSubject.id, ':id'),
        p50: Math.round(percentile(samples, 50)),
        p95: Math.round(percentile(samples, 95)),
        max: Math.round(samples[samples.length - 1] ?? Number.NaN),
      });
    }
    console.log(`provider=${deps.config.databaseProvider} runs=${RUNS} (ms)`);
    console.table(results);
  } finally {
    await dbCache.disconnectAll();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
// Dependency audit gate (SEC-9, delivery-plan.md P10 task 8). Wraps `npm audit --omit=dev
// --json` rather than calling it directly so exactly ONE known false-positive can be
// documented and skipped instead of either permanently red CI or silently lowering the
// severity bar to `critical` for everything.
import { execSync } from 'node:child_process';

// Each entry is a GHSA advisory id this gate is allowed to ignore, with a written reachability
// justification. Keep this list as small as possible — every entry needs a real reason, not
// just "npm audit fix would be inconvenient".
const ALLOWLIST = {
  'GHSA-ggr8-5vv4-36mx': {
    package: 'deepmerge-ts',
    reason:
      "Reachable only via the 'prisma' CLI devDependency's '@prisma/config' (schema/config " +
      "loading for 'prisma generate'/'migrate', run by developers/CI against our own trusted " +
      "schema files) — never imported by '@prisma/client' at runtime, which is what apps/api " +
      'and apps/worker actually ship. npm audit --omit=dev still reports it because `prisma` ' +
      "is a peer dependency of the runtime '@prisma/client' package. Pinning the 'prisma' CLI " +
      "devDependency down to the only currently-available non-vulnerable resolution (6.12.0) " +
      'was tried and rejected: it desyncs from @prisma/client@6.19.3 and broke every ' +
      "integration test (Prisma warns and misbehaves on a CLI/client version mismatch) — a " +
      'strictly worse outcome than accepting this documented, non-reachable advisory.',
  },
};

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let json;
try {
  json = run('npm audit --omit=dev --json');
} catch (err) {
  // npm audit exits non-zero as soon as ANY advisory exists, regardless of severity — the JSON
  // report itself is still on stdout, so recover it from the error object rather than treating
  // this as a hard failure up front.
  json = err.stdout?.toString() ?? '{}';
}

const report = JSON.parse(json);
const vulnerabilities = report.vulnerabilities ?? {};

const blocking = [];
const ignored = [];

for (const vuln of Object.values(vulnerabilities)) {
  if (vuln.severity !== 'high' && vuln.severity !== 'critical') {
    continue;
  }
  const advisories = (vuln.via ?? []).filter((v) => typeof v === 'object');
  const ids = advisories.map((a) => a.url?.split('/').pop()).filter(Boolean);
  const allAllowlisted = ids.length > 0 && ids.every((id) => id in ALLOWLIST);
  if (allAllowlisted) {
    ignored.push({ name: vuln.name, severity: vuln.severity, ids });
  } else if (ids.length > 0) {
    blocking.push({ name: vuln.name, severity: vuln.severity, ids });
  }
  // A vulnerability whose `via` is only other package names (no advisory objects at this node)
  // is a transitive re-export of a finding reported elsewhere in the tree — not double-counted.
}

if (ignored.length > 0) {
  console.log('Ignoring documented, non-reachable advisories:');
  for (const entry of ignored) {
    console.log(`  - ${entry.name} (${entry.severity}): ${entry.ids.join(', ')}`);
  }
}

if (blocking.length > 0) {
  console.error('\nBlocking high/critical production-dependency advisories:');
  for (const entry of blocking) {
    console.error(`  - ${entry.name} (${entry.severity}): ${entry.ids.join(', ')}`);
  }
  console.error('\nRun `npm audit --omit=dev` for full details.');
  process.exit(1);
}

console.log('No blocking high/critical production-dependency advisories.');

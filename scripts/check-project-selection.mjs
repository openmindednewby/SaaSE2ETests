#!/usr/bin/env node
// Gate for ONE class of silent E2E failure: a Playwright project whose
// testMatch selects NOTHING, and a spec file that no project selects.
// Both report "ok" forever - a suite that ran zero tests is not green, it
// is absent. Found live on 2026-09-08: playwright.projects.ts:754 built its
// testMatch as `kefi/<spec>.spec.ts` after the spec had been split into
// `-api` / `-ui`, so 5 assertions (incl. a no-secret-leak scan and a forged
// token wall) ran in no runner while the Tilt resource stayed green.
//
// Usage: node scripts/check-project-selection.mjs   (exit 1 on a gap)
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Spec directories deliberately NOT wired to any project. Each entry must
// say WHERE the coverage actually lives, or it is a defect wearing an
// exemption. Never add an entry to silence a real gap.
const ALLOWED_UNMATCHED = [
  // Superseded by the standalone harness in SyncfusionThemeStudio/test-smoke/
  // (Tilt: theme-studio-smoke-test). Kept for reference, run by nothing here.
  { dir: 'tests/theme-studio', reason: 'superseded by SyncfusionThemeStudio/test-smoke' },
];

const root = process.cwd();
const raw = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32',
});
const report = JSON.parse(raw.slice(raw.indexOf('{')));

const toRegExp = (s) => new RegExp(s.slice(1, s.lastIndexOf('/')), s.slice(s.lastIndexOf('/') + 1));
const projects = report.config.projects.map((p) => ({
  name: p.name, dir: p.testDir.split(path.sep).join('/'), res: p.testMatch.map(toRegExp),
}));

const specs = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); }
    else if (e.name.endsWith('.spec.ts')) specs.push(full.split(path.sep).join('/'));
  }
})(path.join(root, 'tests'));

const failures = [];
const counts = new Map(projects.map((p) => [p.name, 0]));
for (const abs of specs) {
  const hits = projects.filter((p) => abs.startsWith(`${p.dir}/`) && p.res.some((r) => r.test(abs)));
  for (const h of hits) counts.set(h.name, counts.get(h.name) + 1);
  if (hits.length) continue;
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (ALLOWED_UNMATCHED.some((a) => rel.startsWith(`${a.dir}/`))) continue;
  failures.push(`ORPHAN SPEC (no project selects it): ${rel}`);
}
// Setup projects match *.setup.ts, not *.spec.ts - judge them by the tests
// Playwright actually listed rather than by the spec sweep above.
const listed = new Set(Object.values(report.suites ?? []).length ? [] : []);
for (const s of report.suites ?? []) collect(s);
function collect(suite) {
  for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) listed.add(t.projectName);
  for (const c of suite.suites ?? []) collect(c);
}
for (const p of projects) {
  if (counts.get(p.name) === 0 && !listed.has(p.name)) failures.push(`EMPTY PROJECT (selects no tests): ${p.name}`);
}

if (failures.length) {
  console.error(`check-project-selection: ${failures.length} gap(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-project-selection: OK - ${projects.length} projects, ${specs.length} spec files, 0 orphans`);

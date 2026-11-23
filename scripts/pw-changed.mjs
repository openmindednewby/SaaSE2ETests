#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL_RUN_FILES = [
  /^package(-lock)?\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /(^|\/)playwright\.(config|projects[^/]*)\.ts$/,
  /^(fixtures|helpers|shared)\//,
  /global-(setup|teardown)[^/]*\.ts$/,
];
const PASSTHROUGH_FLAGS = ['--ui', '--debug', '--last-failed', '--only-changed', '--test-list'];
const GATE_TARGETS = new Set(['staging', 'prod']);
const NAMED_SPEC = /\.(spec|test)\.[cm]?[jt]s$/;
const GIT_TIMEOUT_MS = 15000;

function tryGit(args) {
  try {
    return execFileSync('git', args, { cwd: E2E_ROOT, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function defaultBranchRef() {
  const head = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head) return head;
  return ['origin/main', 'origin/master'].find((ref) => tryGit(['rev-parse', '--verify', '--quiet', ref])) ?? '';
}

function resolveBase() {
  if (process.env.E2E_BASE) return tryGit(['rev-parse', '--verify', '--quiet', process.env.E2E_BASE]);
  const ref = defaultBranchRef();
  return ref ? tryGit(['merge-base', 'HEAD', ref]) : '';
}

function changedFiles(base) {
  const tracked = tryGit(['diff', '--name-only', '--relative', base]);
  const untracked = tryGit(['ls-files', '--others', '--exclude-standard']);
  return [tracked, untracked].join('\n').split('\n').map((f) => f.trim()).filter(Boolean);
}

function fullRunReason(args) {
  if (args.includes('--full') || process.env.E2E_FULL === '1') return '--full / E2E_FULL=1';
  if (GATE_TARGETS.has(process.env.E2E_TARGET ?? '')) return `E2E_TARGET=${process.env.E2E_TARGET} (gate run)`;
  if (process.env.PWTEST_WATCH) return 'watch mode';
  if (args.some((a) => PASSTHROUGH_FLAGS.some((f) => a === f || a.startsWith(`${f}=`)))) return 'interactive or explicit selection flag';
  if (args.some((a) => NAMED_SPEC.test(a))) return 'named spec file';
  return '';
}

function configArg(args) {
  const i = args.findIndex((a) => a === '--config' || a === '-c');
  const value = i >= 0 ? args[i + 1] : args.find((a) => a.startsWith('--config='))?.slice('--config='.length);
  return value ? path.relative(E2E_ROOT, path.resolve(value)).split(path.sep).join('/') : '';
}

function selection(args) {
  const reason = fullRunReason(args);
  if (reason) return { mode: 'full', reason };
  const base = resolveBase();
  if (!base) return { mode: 'full', reason: 'no git checkout or no origin default branch' };
  const config = configArg(args);
  const trigger = changedFiles(base).find((f) => f === config || FULL_RUN_FILES.some((re) => re.test(f)));
  if (trigger) return { mode: 'full', reason: `shared file changed: ${trigger}` };
  return { mode: 'changed', base };
}

function playwrightCli() {
  const require = createRequire(path.join(E2E_ROOT, 'package.json'));
  return path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
}

function main() {
  const args = process.argv.slice(2);
  const pick = selection(args);
  const pwArgs = ['test', ...args.filter((a) => a !== '--full')];
  if (pick.mode === 'changed') {
    pwArgs.push(`--only-changed=${pick.base}`);
    console.log(`only-changed: specs changed since ${pick.base.slice(0, 12)} (merge-base); 0 tests = no spec changed, NOT a pass of an app change; add --full or E2E_FULL=1 for all`);
  } else {
    console.log(`only-changed: full run (${pick.reason})`);
  }
  const run = spawnSync(process.execPath, [playwrightCli(), ...pwArgs], { cwd: process.cwd(), stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

main();

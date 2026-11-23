#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAAS_ROOT = path.resolve(E2E_ROOT, '..');
const FULL_RUN_FILES = [
  /^package(-lock)?\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /(^|\/)playwright\.(config|projects[^/]*)\.ts$/,
  /^(fixtures|helpers|shared)\//,
  /global-(setup|teardown)[^/]*\.ts$/,
];
const APP_SPECS = {
  agora: { repos: ['AgoraService', 'agora-web', 'agora-storefront'], specs: ['tests/agora'] },
  aml: { repos: ['PROOViD/AMLService', 'apps/aml-v2'], specs: ['tests/aml'] },
  billing: { repos: ['PaymentService'], specs: ['tests/billing'] },
  content: { repos: ['ContentService'], specs: ['tests/content'] },
  'digital-kin': { repos: ['DigitalKinService', 'digital-kin-admin'], specs: ['tests/digital-kin'] },
  erevna: { repos: ['erevna-web'], specs: ['tests/erevna'] },
  ichnos: { repos: ['IchnosService', 'ichnos-web'], specs: ['tests/ichnos'] },
  identity: { repos: ['TenantService', 'KeycloakProviders'], specs: ['tests/identity'] },
  jinx: { repos: ['JinxService', 'jinx-site'], specs: ['tests/jinx'] },
  kefi: {
    repos: ['KefiService', 'kefi-web', 'kefi-landings'],
    specs: ['tests/kefi', 'tests/kefi-crew-commissions', 'tests/kefi-landing-parity', 'tests/kefi-mobile-review', 'tests/kefi-organizer-events', 'tests/kefi-privacy', 'tests/kucy-recreate'],
  },
  nextgame: { repos: ['NextGameService', 'nextgame-web'], specs: ['tests/nextgame'] },
  notification: { repos: ['NotificationService'], specs: ['tests/notifications'] },
  online: { repos: ['OnlineMenuSaaS'], specs: ['tests/online-menus', 'tests/menu-styling'] },
  poueni: { repos: ['Poueni'], specs: ['tests/poueni'] },
  questioner: { repos: ['QuestionerService'], specs: ['tests/questioner'] },
  selida: { repos: ['SelidaService', 'selida-web'], specs: ['tests/selida'] },
  tenant: { repos: ['TenantThemeEditor'], specs: ['tests/tenant-themes'] },
  theme: { repos: ['SyncfusionThemeStudio'], specs: ['tests/theme-studio'] },
  ui: { repos: ['apps/ui-showcase'], specs: ['tests/ui-showcase'] },
  zygos: { repos: ['zygos'], specs: ['tests/zygos'] },
};
const PASSTHROUGH_FLAGS = ['--ui', '--debug', '--last-failed', '--only-changed', '--test-list'];
const GATE_TARGETS = new Set(['staging', 'prod']);
const NAMED_SPEC = /\.(spec|test)\.[cm]?[jt]s$/;
const GIT_TIMEOUT_MS = 15000;
const LIST_BUFFER_BYTES = 64 * 1024 * 1024;
const NOTHING_PICKED_EXIT = 3;

function tryGit(args, cwd = E2E_ROOT) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function resolveBase(cwd, override) {
  if (override) return tryGit(['rev-parse', '--verify', '--quiet', override], cwd);
  const ref = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd)
    || ['origin/main', 'origin/master'].find((r) => tryGit(['rev-parse', '--verify', '--quiet', r], cwd));
  return ref ? tryGit(['merge-base', 'HEAD', ref], cwd) : '';
}

function changedFiles(base, cwd = E2E_ROOT) {
  const tracked = tryGit(['diff', '--name-only', '--relative', base], cwd);
  const untracked = tryGit(['ls-files', '--others', '--exclude-standard'], cwd);
  return [tracked, untracked].join('\n').split('\n').map((f) => f.trim()).filter(Boolean);
}

function repoChanged(repoDir) {
  if (!existsSync(repoDir)) return false;
  const base = resolveBase(repoDir);
  return Boolean(base) && changedFiles(base, repoDir).length > 0;
}

function packageName(repoDir) {
  const file = path.join(repoDir, 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).name ?? '' : '';
}

function appsDependingOn(pkg) {
  return Object.keys(APP_SPECS).filter((app) => APP_SPECS[app].repos.some((repo) => {
    const file = path.join(SAAS_ROOT, repo, 'package.json');
    return existsSync(file) && readFileSync(file, 'utf8').includes(`"${pkg}"`);
  }));
}

function appFromRepo(repoDir) {
  const rel = path.relative(SAAS_ROOT, repoDir).split(path.sep).join('/');
  return Object.keys(APP_SPECS).find((app) => APP_SPECS[app].repos.includes(rel)) ?? '';
}

function appFromScript() {
  const script = (process.env.npm_lifecycle_event ?? '').replace(/^test:/, '');
  const matches = Object.keys(APP_SPECS).filter((app) => script === app || script.startsWith(`${app}-`) || script.startsWith(`${app}:`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? '';
}

function packageSpecs(repoDir) {
  const pkg = packageName(repoDir);
  const apps = pkg.startsWith('@dloizides/') && repoChanged(repoDir) ? appsDependingOn(pkg) : [];
  return apps.length ? { why: `${pkg} changed, used by ${apps.join(', ')}`, specs: apps.flatMap((a) => APP_SPECS[a].specs) } : null;
}

function changedAppSpecs() {
  const repoEnv = process.env.E2E_APP_REPO ? path.resolve(SAAS_ROOT, process.env.E2E_APP_REPO) : '';
  const app = process.env.E2E_APP || (repoEnv ? appFromRepo(repoEnv) : appFromScript());
  if (repoEnv && !app) return packageSpecs(repoEnv);
  if (!APP_SPECS[app]) return null;
  const changed = APP_SPECS[app].repos.filter((repo) => repoChanged(path.join(SAAS_ROOT, repo)));
  return changed.length ? { why: `app ${app} changed in ${changed.join(', ')}`, specs: APP_SPECS[app].specs } : null;
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
  const base = resolveBase(E2E_ROOT, process.env.E2E_BASE);
  if (!base) return { mode: 'full', reason: 'no git checkout or no origin default branch' };
  const config = configArg(args);
  const trigger = changedFiles(base).find((f) => f === config || FULL_RUN_FILES.some((re) => re.test(f)));
  if (trigger) return { mode: 'full', reason: `shared file changed: ${trigger}` };
  const app = changedAppSpecs();
  return app ? { mode: 'app', ...app } : { mode: 'changed', base };
}

function playwrightCli() {
  const require = createRequire(path.join(E2E_ROOT, 'package.json'));
  return path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
}

function countTests(suite) {
  return (suite.specs?.length ?? 0) + (suite.suites ?? []).reduce((n, s) => n + countTests(s), 0);
}

function pickedCount(pwArgs) {
  const list = spawnSync(process.execPath, [playwrightCli(), ...pwArgs, '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: LIST_BUFFER_BYTES });
  try {
    return countTests(JSON.parse(list.stdout.slice(list.stdout.indexOf('{'))));
  } catch {
    return -1;
  }
}

function buildArgs(args, pick) {
  const pwArgs = ['test', ...args.filter((a) => a !== '--full')];
  if (pick.mode === 'app') pwArgs.push(...pick.specs);
  if (pick.mode === 'changed') pwArgs.push(`--only-changed=${pick.base}`);
  return pwArgs;
}

function main() {
  const args = process.argv.slice(2);
  const pick = selection(args);
  const pwArgs = buildArgs(args, pick);
  if (pick.mode === 'full') console.log(`only-changed: full run (${pick.reason})`);
  if (pick.mode === 'app') console.log(`only-changed: ${pick.why} -> ${pick.specs.join(' ')}`);
  if (pick.mode === 'changed') console.log(`only-changed: E2E specs changed since ${pick.base.slice(0, 12)} (merge-base), no app change found`);
  if (pick.mode !== 'full' && pickedCount(pwArgs) === 0) {
    console.log('only-changed: 0 tests picked -- UNKNOWN, NOT a pass. Set E2E_APP_REPO=<app repo> or E2E_APP=<app>, or add --full / E2E_FULL=1.');
    process.exit(NOTHING_PICKED_EXIT);
  }
  const run = spawnSync(process.execPath, [playwrightCli(), ...pwArgs], { cwd: process.cwd(), stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

main();

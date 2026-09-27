/**
 * Scheduled-run mode — TEST-5MIN-1a "Quarantine + no retries + ≤240 s groups"
 * (BaseClient/docs/Tasks/IN_PROGRESS/TEST-5MIN-1-test-runs-under-5-minutes.md, owner decisions Q1-Q4).
 *
 * Every scheduled (CronJob / Indexed Job) run is ONE pod of ≤ 300 s. This module turns the full
 * project list into what that pod runs:
 *   - E2E_GROUP_INDEX=<n>   keep only group n of scheduled/scheduled-groups.json for the target
 *                           (+ the projects those depend on). Maps 1:1 to a k8s Indexed Job's
 *                           JOB_COMPLETION_INDEX. Setting it implies scheduled mode.
 *   - E2E_GROUP_TARGET      staging | prod | poueni (defaults to E2E_TARGET).
 *   - E2E_SCHEDULED=1       retries 0, per-test cap 200 s, global run limit 270 s, quarantined
 *                           tests excluded. Also implied by E2E_GROUP_INDEX.
 *   - E2E_QUARANTINE=1      the quarantine lane: run ONLY the quarantined tests (manual, never
 *                           scheduled — owner Q4 "quarantine never").
 * With none of these set the config is unchanged (Tilt / on-demand runs keep their long timeouts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Project } from '@playwright/test';

/** Longest measured green test is 187 s (kefi-free-publish, prod). */
export const SCHEDULED_TEST_TIMEOUT_MS = 200_000;
/** Playwright stops itself and writes its reports before the 330 s pod deadline. */
export const SCHEDULED_GLOBAL_TIMEOUT_MS = 270_000;

const SCHEDULED_DIR = path.join(__dirname, 'scheduled');

interface QuarantineEntry {
  file: string;
  title: string;
  project: string;
}

interface GroupFile {
  capSeconds: number;
  /** Scheduled-only project splits: name -> { base project, testMatch source }. */
  splits: Record<string, { base: string; testMatch: string }>;
  targets: Record<string, Array<{ projects: string[] }>>;
}

const env = (name: string): string | undefined => process.env[name] || undefined;

export const isQuarantineLane = (): boolean => env('E2E_QUARANTINE') === '1';
export const isScheduled = (): boolean =>
  env('E2E_SCHEDULED') === '1' || env('E2E_GROUP_INDEX') !== undefined || isQuarantineLane();

const groupTarget = (): string => env('E2E_GROUP_TARGET') ?? env('E2E_TARGET') ?? 'local';

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(SCHEDULED_DIR, file), 'utf8')) as T;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Quarantine list for a target. poueni runs against prod, so it uses the prod list. */
function quarantineFor(target: string): QuarantineEntry[] {
  const all = readJson<Record<string, QuarantineEntry[]>>('quarantine.json');
  const key = target === 'poueni' ? 'prod' : target;
  return all[key] ?? [];
}

/**
 * One alternative per quarantined test, matched against Playwright's grep title
 * (`project file describe… title @tags`). File separators are matched either way so a local
 * Windows run and the Linux pod select the same tests.
 */
function quarantineRegex(entries: QuarantineEntry[]): RegExp | undefined {
  if (!entries.length) return undefined;
  const alts = entries.map(e => {
    const file = e.file.split('/').map(escapeRe).join('[\\\\/]');
    return `${file}[\\s\\S]* ${escapeRe(e.title)}(?: @\\S+)*$`;
  });
  return new RegExp(`(?:${alts.join('|')})`);
}

function withDependencies(all: Project[], names: Set<string>): Project[] {
  const byName = new Map(all.map(p => [p.name, p]));
  const keep = new Set<string>();
  const visit = (n: string): void => {
    if (keep.has(n)) return;
    keep.add(n);
    for (const dep of byName.get(n)?.dependencies ?? []) visit(dep);
  };
  names.forEach(visit);
  return all.filter(p => p.name !== undefined && keep.has(p.name));
}

function materialiseSplits(all: Project[], groups: GroupFile): Project[] {
  const byName = new Map(all.map(p => [p.name, p]));
  const extra = Object.entries(groups.splits).flatMap(([name, s]) => {
    const base = byName.get(s.base);
    return base ? [{ ...base, name, testMatch: new RegExp(s.testMatch) }] : [];
  });
  return [...all, ...extra];
}

function selectGroup(all: Project[]): Project[] {
  const index = env('E2E_GROUP_INDEX');
  if (index === undefined) return all;
  const groups = readJson<GroupFile>('scheduled-groups.json');
  const target = groupTarget();
  const list = groups.targets[target];
  const group = list?.[Number(index)];
  if (!group)
    throw new Error(
      `E2E_GROUP_INDEX=${index}: no such group for target "${target}" ` +
        `(scheduled/scheduled-groups.json has ${list?.length ?? 0})`,
    );
  return withDependencies(materialiseSplits(all, groups), new Set(group.projects));
}

const capTimeout = (t: number | undefined): number =>
  Math.min(t ?? SCHEDULED_TEST_TIMEOUT_MS, SCHEDULED_TEST_TIMEOUT_MS);

/** Apply scheduled mode to the project list. Identity when not scheduled. */
export function applyScheduledMode(projects: Project[]): Project[] {
  if (!isScheduled()) return projects;
  const q = quarantineRegex(quarantineFor(groupTarget()));
  return selectGroup(projects).map(p => {
    const out: Project = { ...p, retries: 0, timeout: capTimeout(p.timeout) };
    if (isQuarantineLane()) out.grep = q ?? /$^/;
    else if (q) out.grepInvert = q;
    return out;
  });
}

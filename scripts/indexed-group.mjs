/**
 * Indexed-Job group resolution — TEST-5MIN-1b "Indexed Jobs per target"
 * (BaseClient/docs/Tasks/IN_PROGRESS/TEST-5MIN-1-test-runs-under-5-minutes.md).
 *
 * A k8s Indexed Job sets JOB_COMPLETION_INDEX on every pod. This module maps it to one group of
 * scheduled/scheduled-groups.json for a target. Pure (no fs, no process) so it is unit-tested in
 * indexed-group.test.mjs; run-canary-incluster.mjs does the I/O.
 *
 * Precedence: E2E_GROUP_INDEX (manual override, e.g. "plant") > JOB_COMPLETION_INDEX.
 * Target:     E2E_GROUP_TARGET > E2E_TARGET.
 * playwright.scheduled.ts performs the same lookup inside the config; this copy exists so the runner
 * can fail fast with a readable message and name the S3 report key before Playwright starts.
 */

/** The planted-slow group (scheduled/plant/plant-slow.spec.ts). Never part of a numbered group. */
export const PLANT_INDEX = 'plant';
export const PLANT_PROJECT = 'scheduled-plant-slow';

const INDEX_PAD = 2;

/** True when the runner should use the Indexed mode. */
export function isIndexedRun(env) {
  return Boolean(env.E2E_GROUP_INDEX || env.JOB_COMPLETION_INDEX);
}

/**
 * @returns {{ index: number|string, label: string, target: string, projects: string[], estimated: boolean }}
 * @throws Error with the reason when the index or target does not name a group.
 */
export function resolveIndexedGroup(env, groups) {
  const raw = (env.E2E_GROUP_INDEX || env.JOB_COMPLETION_INDEX || '').trim();
  const target = env.E2E_GROUP_TARGET || env.E2E_TARGET || '';
  if (!raw) throw new Error('neither E2E_GROUP_INDEX nor JOB_COMPLETION_INDEX is set');
  if (!target) throw new Error('neither E2E_GROUP_TARGET nor E2E_TARGET is set');
  if (raw === PLANT_INDEX)
    return { index: PLANT_INDEX, label: PLANT_INDEX, target, projects: [PLANT_PROJECT], estimated: false };
  if (!/^\d+$/.test(raw)) throw new Error(`group index "${raw}" is not a non-negative integer or "${PLANT_INDEX}"`);
  const list = groups?.targets?.[target];
  if (!list) throw new Error(`target "${target}" has no groups in scheduled/scheduled-groups.json`);
  const index = Number(raw);
  const group = list[index];
  if (!group)
    throw new Error(`group index ${index} out of range for target "${target}" (${list.length} groups: 0..${list.length - 1})`);
  return {
    index,
    label: `g${String(index).padStart(INDEX_PAD, '0')}`,
    target,
    projects: [...group.projects],
    estimated: group.estimated === true,
  };
}

/** S3 run folder: `<target>/<label>-<runId>` — target + index in the key, one folder per pod. */
export function indexedReportPrefix(group, runId) {
  return `${group.target}/${group.label}-${runId}`;
}

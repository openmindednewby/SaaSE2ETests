// Unit tests for the Indexed-Job group mapping (TEST-5MIN-1b "Indexed Jobs per target").
// Run: node --test scripts/indexed-group.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLANT_INDEX,
  PLANT_PROJECT,
  indexedReportPrefix,
  isIndexedRun,
  resolveIndexedGroup,
} from './indexed-group.mjs';

const GROUPS = {
  targets: {
    staging: [{ projects: ['a', 'b'] }, { projects: ['c'], estimated: true }],
    poueni: [{ projects: ['poueni-gdpr'] }],
  },
};

test('JOB_COMPLETION_INDEX selects the group for E2E_TARGET', () => {
  const g = resolveIndexedGroup({ JOB_COMPLETION_INDEX: '1', E2E_TARGET: 'staging' }, GROUPS);
  assert.deepEqual(g, { index: 1, label: 'g01', target: 'staging', projects: ['c'], estimated: true });
});

test('E2E_GROUP_TARGET wins over E2E_TARGET (poueni runs against prod)', () => {
  const g = resolveIndexedGroup({ JOB_COMPLETION_INDEX: '0', E2E_TARGET: 'prod', E2E_GROUP_TARGET: 'poueni' }, GROUPS);
  assert.equal(g.target, 'poueni');
  assert.deepEqual(g.projects, ['poueni-gdpr']);
});

test('E2E_GROUP_INDEX overrides JOB_COMPLETION_INDEX', () => {
  const g = resolveIndexedGroup({ JOB_COMPLETION_INDEX: '1', E2E_GROUP_INDEX: '0', E2E_TARGET: 'staging' }, GROUPS);
  assert.equal(g.index, 0);
});

test('"plant" selects only the planted project, never a numbered group', () => {
  const g = resolveIndexedGroup({ E2E_GROUP_INDEX: PLANT_INDEX, E2E_TARGET: 'staging' }, GROUPS);
  assert.deepEqual(g.projects, [PLANT_PROJECT]);
  const numbered = Object.values(GROUPS.targets).flat().flatMap((x) => x.projects);
  assert.ok(!numbered.includes(PLANT_PROJECT));
});

test('out-of-range index names the valid range', () => {
  assert.throws(
    () => resolveIndexedGroup({ JOB_COMPLETION_INDEX: '2', E2E_TARGET: 'staging' }, GROUPS),
    /out of range for target "staging" \(2 groups: 0\.\.1\)/,
  );
});

test('unknown target, non-numeric index and missing env all throw', () => {
  assert.throws(() => resolveIndexedGroup({ JOB_COMPLETION_INDEX: '0', E2E_TARGET: 'nope' }, GROUPS), /no groups/);
  assert.throws(() => resolveIndexedGroup({ JOB_COMPLETION_INDEX: '-1', E2E_TARGET: 'staging' }, GROUPS), /not a non-negative/);
  assert.throws(() => resolveIndexedGroup({ E2E_TARGET: 'staging' }, GROUPS), /neither E2E_GROUP_INDEX/);
  assert.throws(() => resolveIndexedGroup({ JOB_COMPLETION_INDEX: '0' }, GROUPS), /neither E2E_GROUP_TARGET/);
});

test('isIndexedRun is true only when an index is set', () => {
  assert.equal(isIndexedRun({}), false);
  assert.equal(isIndexedRun({ JOB_COMPLETION_INDEX: '0' }), true);
  assert.equal(isIndexedRun({ E2E_GROUP_INDEX: PLANT_INDEX }), true);
});

test('report prefix carries target and index', () => {
  const g = resolveIndexedGroup({ JOB_COMPLETION_INDEX: '1', E2E_TARGET: 'staging' }, GROUPS);
  assert.equal(indexedReportPrefix(g, 'r1'), 'staging/g01-r1');
});

test('the committed scheduled-groups.json never lists the planted project', async () => {
  const { readFile } = await import('node:fs/promises');
  const real = JSON.parse(await readFile(new URL('../scheduled/scheduled-groups.json', import.meta.url), 'utf8'));
  const all = Object.values(real.targets).flat().flatMap((x) => x.projects);
  assert.ok(all.length > 0, 'probe sanity: groups file lists projects');
  assert.ok(!all.includes(PLANT_PROJECT));
});

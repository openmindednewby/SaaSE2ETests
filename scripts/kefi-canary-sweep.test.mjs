// Run: node --test scripts/kefi-canary-sweep.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { canaryIdFromSlug, kefiSweepEnvGaps, sweepPublishedKefiCanaries } from './kefi-canary-sweep.mjs';

function fakeKefiApi({ slugs, listStatus = 200, tenantsDeletedById = {}, cleanupStatus = 200 }) {
  const deletes = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/t') {
      return { status: listStatus, json: async () => slugs.map((slug) => ({ slug })) };
    }
    const canaryId = parsed.searchParams.get('canaryId');
    deletes.push({ canaryId, method: init.method, authorization: init.headers?.Authorization });
    return { status: cleanupStatus, json: async () => ({ tenantsDeleted: tenantsDeletedById[canaryId] ?? 1 }) };
  };
  return { fetchImpl, deletes };
}

function sweepInput(fetchImpl, dryRun = false) {
  return { apiUrl: 'https://kefi.test', getBearer: async () => 'bearer-1', fetchImpl, dryRun, log: () => {} };
}

test('KEFI-CANARY-LEAK-1 with a leaked canary beside a customer, sweeps only the canary', async () => {
  const api = fakeKefiApi({ slugs: ['kizombaunioncy', 'e2c-33b82b03-canary-tenant'] });

  const result = await sweepPublishedKefiCanaries(sweepInput(api.fetchImpl));

  assert.deepEqual(api.deletes, [{ canaryId: '33b82b03', method: 'DELETE', authorization: 'Bearer bearer-1' }]);
  assert.deepEqual(result, { published: 2, canaries: ['33b82b03'], swept: ['33b82b03'], failed: [] });
});

test('KEFI-CANARY-LEAK-1 with a dry run, deletes nothing and still names the canary', async () => {
  const api = fakeKefiApi({ slugs: ['e2c-33b82b03-canary-tenant'] });

  const result = await sweepPublishedKefiCanaries(sweepInput(api.fetchImpl, true));

  assert.deepEqual(api.deletes, []);
  assert.deepEqual(result, { published: 1, canaries: ['33b82b03'], swept: [], failed: [] });
});

test('KEFI-CANARY-LEAK-1 when cleanup answers 200 but deleted no tenant, reports the id as failed', async () => {
  const api = fakeKefiApi({ slugs: ['e2c-33b82b03-canary-tenant'], tenantsDeletedById: { '33b82b03': 0 } });

  const result = await sweepPublishedKefiCanaries(sweepInput(api.fetchImpl));

  assert.deepEqual(result.failed, ['33b82b03']);
  assert.deepEqual(result.swept, []);
});

test('KEFI-CANARY-LEAK-1 when cleanup answers 500, reports the id as failed', async () => {
  const api = fakeKefiApi({ slugs: ['e2c-33b82b03-canary-tenant'], cleanupStatus: 500 });

  const result = await sweepPublishedKefiCanaries(sweepInput(api.fetchImpl));

  assert.deepEqual(result.failed, ['33b82b03']);
});

test('KEFI-CANARY-LEAK-1 when the published list answers 503, throws instead of reporting zero canaries', async () => {
  const api = fakeKefiApi({ slugs: [], listStatus: 503 });

  await assert.rejects(() => sweepPublishedKefiCanaries(sweepInput(api.fetchImpl)), /503/);
});

test('KEFI-CANARY-LEAK-1 slug shapes, only e2c-{8 hex}-{rest} yields a canary id', () => {
  assert.equal(canaryIdFromSlug('e2c-33b82b03-canary-tenant'), '33b82b03');
  assert.equal(canaryIdFromSlug('e2c-ce06c6fa-api'), 'ce06c6fa');
  assert.equal(canaryIdFromSlug('kizombaunioncy'), null);
  assert.equal(canaryIdFromSlug('e2c-33b82b03'), null);
  assert.equal(canaryIdFromSlug('e2c-33B82B03-canary-tenant'), null);
  assert.equal(canaryIdFromSlug('e2c-33b82b0-canary-tenant'), null);
  assert.equal(canaryIdFromSlug('e2ec-33b82b03-canary-tenant'), null);
  assert.equal(canaryIdFromSlug('my-e2c-33b82b03-canary-tenant'), null);
});

test('KEFI-CANARY-LEAK-1 env gaps, names each missing variable', () => {
  const env = { KEFI_API_URL: 'https://kefi.test', KEFI_KC_URL: 'https://kc.test', KEFI_KC_REALM: 'kefi' };

  const gaps = kefiSweepEnvGaps(env);

  assert.deepEqual(gaps, [
    'KEFI_BFF_CLIENT_ID',
    'KEFI_BFF_CLIENT_SECRET',
    'KEFI_PLATFORM_ADMIN_USERNAME',
    'KEFI_PLATFORM_ADMIN_PASSWORD',
  ]);
});

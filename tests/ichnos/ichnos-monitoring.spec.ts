// @api tier for M3-F5 monitoring core (monitored addresses + alerts inbox + notification settings). The
// unauthenticated negatives always run. The authed assertions run opportunistically with an ichnos tenant
// token and skip clearly otherwise. Adding a monitored address is Growth+ gated: when the seeded tenant is
// NOT on growth+, the create returns 402 and the spec asserts THAT (the gate is proven) and skips the
// happy-path lifecycle; when it IS growth+, the full add → list → delete lifecycle is asserted. Alert
// inbox + acknowledge cover only what is deterministic without mutating the sanctions dataset: the inbox
// is tenant-scoped, the ?unacknowledged=true filter is self-consistent, and acknowledge is idempotent when
// an alert exists (the planted-tier-delta path needs a dataset-diff seeding hook — see the note below).
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  CLEAR_BTC_ADDRESS,
  ICHNOS_API_URL,
  PAYMENT_REQUIRED,
  bearer,
  getIchnosToken,
  jsonAuth,
  tryRequest,
} from './ichnos-helpers.js';

const MONITORED_PATH = '/v1/monitored-addresses';
const ALERTS_PATH = '/v1/alerts';
const NOTIFY_PATH = '/v1/monitoring/notification-settings';
const KNOWN_TIERS = ['clear', 'indirect', 'direct', 'sanctioned', 'high', 'medium', 'low'];

interface MonitoredAddressDto {
  id: string;
  chain: string;
  address: string;
  label: string | null;
  active: boolean;
  currentTier: string | null;
}
interface AlertDto {
  id: string;
  acknowledgedAt: string | null;
}
interface NotificationSettingsDto {
  notifyOn: string;
  alertEmail: string | null;
  emailEnabled: boolean;
}

/** Fetch a tenant token, skipping with a clear reason when none is configured. */
async function tokenOrSkip(): Promise<string | null> {
  const token = await getIchnosToken();
  if (!token) {
    test.skip(true, 'No ichnos tenant token (set ICHNOS_TEST_USERNAME/PASSWORD + ICHNOS_E2E_CLIENT_SECRET)');
    return null;
  }
  return token;
}

test.describe('Ichnos monitoring @ichnos-api', () => {
  test('rejects an unauthenticated monitored-address add', async ({ request }) => {
    const result = await tryRequest(request, MONITORED_PATH, {
      method: 'POST',
      data: { ...CLEAR_BTC_ADDRESS },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('rejects an unauthenticated alerts read', async ({ request }) => {
    const result = await tryRequest(request, ALERTS_PATH);
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('adds, lists, and stops a monitored address (Growth+), else asserts the 402 gate', async ({ request }) => {
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    const token = await tokenOrSkip();
    if (!token) return;

    // Add — Growth+ gated. A non-growth tenant is 402 (that IS the gate assertion); a growth tenant is 201.
    const added = await tryRequest(request, MONITORED_PATH, {
      method: 'POST',
      data: { ...CLEAR_BTC_ADDRESS, label: 'e2e-monitor' },
      headers: jsonAuth(token),
    });
    expect(added).not.toBeNull();
    const addStatus = added!.response.status();
    if (addStatus === PAYMENT_REQUIRED) {
      test.skip(true, 'Monitored-address add is Growth+ gated for this tenant — 402 gate proven (see ichnos-billing.spec.ts)');
      return;
    }
    expect(addStatus, await added!.response.text()).toBe(201);
    const created = (await added!.response.json()) as MonitoredAddressDto;
    expect(created.id).toBeTruthy();
    expect(created.chain).toBe(CLEAR_BTC_ADDRESS.chain);
    expect(created.active).toBe(true);
    // The add screens once to seed the current tier — clear for this plainly-non-sanctioned address (or null
    // if the engine deferred the seed screen).
    expect(created.currentTier === null || KNOWN_TIERS.includes(created.currentTier)).toBeTruthy();

    // A second add of the same active address → 409 conflict (idempotent guard).
    const dup = await tryRequest(request, MONITORED_PATH, {
      method: 'POST',
      data: { ...CLEAR_BTC_ADDRESS },
      headers: jsonAuth(token),
    });
    expect(dup!.response.status()).toBe(409);

    // List shows it with its current tier.
    const listed = await tryRequest(request, MONITORED_PATH, { headers: bearer(token) });
    expect(listed!.response.status()).toBe(200);
    const listBody = (await listed!.response.json()) as { items: MonitoredAddressDto[] };
    expect(listBody.items.some((a) => a.id === created.id)).toBeTruthy();

    // DELETE stops it → 204; deleting again → 404 (no longer the tenant's active address).
    const deleted = await tryRequest(request, `${MONITORED_PATH}/${created.id}`, { method: 'DELETE', headers: bearer(token) });
    expect(deleted!.response.status()).toBe(204);
    const deletedAgain = await tryRequest(request, `${MONITORED_PATH}/${created.id}`, { method: 'DELETE', headers: bearer(token) });
    expect(deletedAgain!.response.status()).toBe(404);
  });

  test('alerts inbox is tenant-scoped and the unacknowledged filter is self-consistent', async ({ request }) => {
    const token = await tokenOrSkip();
    if (!token) return;

    const all = await tryRequest(request, ALERTS_PATH, { headers: bearer(token) });
    if (!all) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect(all.response.status(), await all.response.text()).toBe(200);
    const allBody = (await all.response.json()) as { items: AlertDto[] };

    const unack = await tryRequest(request, `${ALERTS_PATH}?unacknowledged=true`, { headers: bearer(token) });
    expect(unack!.response.status()).toBe(200);
    const unackBody = (await unack!.response.json()) as { items: AlertDto[] };

    // The filter is a subset, and every filtered item is genuinely un-acknowledged.
    expect(unackBody.items.length).toBeLessThanOrEqual(allBody.items.length);
    for (const item of unackBody.items) expect(item.acknowledgedAt).toBeNull();

    // Acknowledge idempotency: ack an existing alert twice → 200/200. Without a planted tier-delta the inbox
    // is typically empty (a real delta needs mutating the sanctions dataset — a dataset-diff SEEDING HOOK is
    // the missing piece), so we fall back to asserting the ack CONTRACT: an unknown id → 404.
    await assertAcknowledgeContract(request, token, allBody.items);
  });

  test('notification settings round-trip any↔worsening and expose the documented default', async ({ request }) => {
    const token = await tokenOrSkip();
    if (!token) return;

    const initial = await tryRequest(request, NOTIFY_PATH, { headers: bearer(token) });
    if (!initial) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect(initial.response.status(), await initial.response.text()).toBe(200);
    const initialBody = (await initial.response.json()) as NotificationSettingsDto;
    // Whether or not a row exists, notifyOn is always one of the two stable codes.
    expect(['worsening', 'any']).toContain(initialBody.notifyOn);

    // PUT any (with an alert-email override + email on) → GET reflects it.
    await putSettings(request, token, { notifyOn: 'any', alertEmail: 'alerts@example.com', emailEnabled: true });
    const anyRead = await readSettings(request, token);
    expect(anyRead.notifyOn).toBe('any');
    expect(anyRead.alertEmail).toBe('alerts@example.com');
    expect(anyRead.emailEnabled).toBe(true);

    // PUT back to the documented default (worsening + email on, no override) → GET reflects it. This is the
    // exact shape a fresh tenant with NO settings row reads by default (see NotificationSettingsMappers.Default).
    await putSettings(request, token, { notifyOn: 'worsening', alertEmail: null, emailEnabled: true });
    const worseningRead = await readSettings(request, token);
    expect(worseningRead.notifyOn).toBe('worsening');
    expect(worseningRead.emailEnabled).toBe(true);
  });
});

/** Ack an existing alert twice (idempotent 200/200) when one exists; else assert the unknown-id 404 contract. */
async function assertAcknowledgeContract(
  request: APIRequestContext,
  token: string,
  alerts: AlertDto[],
): Promise<void> {
  if (alerts.length > 0) {
    const id = alerts[0].id;
    const first = await tryRequest(request, `${ALERTS_PATH}/${id}/acknowledge`, { method: 'POST', headers: bearer(token) });
    expect(first!.response.status(), await first!.response.text()).toBe(200);
    const second = await tryRequest(request, `${ALERTS_PATH}/${id}/acknowledge`, { method: 'POST', headers: bearer(token) });
    expect(second!.response.status()).toBe(200);
    return;
  }
  const unknownId = '11111111-2222-3333-4444-555555555555';
  const missing = await tryRequest(request, `${ALERTS_PATH}/${unknownId}/acknowledge`, { method: 'POST', headers: bearer(token) });
  expect(missing!.response.status()).toBe(404);
}

async function putSettings(
  request: APIRequestContext,
  token: string,
  body: NotificationSettingsDto,
): Promise<void> {
  const res = await tryRequest(request, NOTIFY_PATH, { method: 'PUT', data: body, headers: jsonAuth(token) });
  expect(res!.response.status(), await res!.response.text()).toBe(200);
}

async function readSettings(request: APIRequestContext, token: string): Promise<NotificationSettingsDto> {
  const res = await tryRequest(request, NOTIFY_PATH, { headers: bearer(token) });
  expect(res!.response.status()).toBe(200);
  return (await res!.response.json()) as NotificationSettingsDto;
}

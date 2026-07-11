// @api tier for M3 Wave-2 webhooks (F3). The unauthenticated negative always runs. With an ichnos tenant
// token: the SSRF/scheme guard is asserted (http, loopback, link-local cloud-metadata, and private-network
// targets are all rejected 400 BEFORE the plan gate — validation runs pre-handler), and the register →
// secret-shown-once → list-never-leaks-secret → revoke lifecycle is asserted opportunistically (Growth+
// gated: a non-growth tenant returns 402, which IS the gate assertion). The both-channels DELIVERY E2E
// (real webhook receipt + real alert email) is infra-gated and `test.skip`s unless a public sink + IMAP
// inbox are configured — see the note in the last test.
import { expect, test } from '@playwright/test';
import {
  ICHNOS_API_URL,
  ICHNOS_WEBHOOK_SINK_URL,
  PAYMENT_REQUIRED,
  bearer,
  getIchnosToken,
  hasEmailInboxConfigured,
  jsonAuth,
  tryRequest,
} from './ichnos-helpers.js';

const WEBHOOKS_PATH = '/v1/webhooks';
// A well-formed PUBLIC https target that passes the scheme + SSRF guard. example.com resolves to public
// space, so the register reaches the plan gate (201 on growth+, 402 otherwise) rather than a 400.
const PUBLIC_HTTPS_URL = 'https://example.com/ichnos-e2e-hook';

// Each of these MUST be rejected 400 by RegisterWebhookRequestValidator, independent of DNS (they use
// literal IPs / a non-https scheme), so the assertion is deterministic on any runner:
const REJECTED_TARGETS: Array<{ url: string; why: string }> = [
  { url: 'http://example.com/hook', why: 'non-https scheme' },
  { url: 'https://127.0.0.1/hook', why: 'loopback' },
  { url: 'https://169.254.169.254/latest/meta-data/', why: 'link-local cloud-metadata' },
  { url: 'https://10.0.0.5/hook', why: 'private 10/8' },
  { url: 'https://192.168.1.10/hook', why: 'private 192.168/16' },
];

interface RegisteredWebhookResult {
  id: string;
  url: string;
  signingSecret: string;
}
interface WebhookSummaryDto {
  id: string;
  url: string;
  active: boolean;
  lastDeliveryStatus: string | null;
}

async function tokenOrSkip(): Promise<string | null> {
  const token = await getIchnosToken();
  if (!token) {
    test.skip(true, 'No ichnos tenant token (set ICHNOS_TEST_USERNAME/PASSWORD + ICHNOS_E2E_CLIENT_SECRET)');
    return null;
  }
  return token;
}

test.describe('Ichnos webhooks @ichnos-api', () => {
  test('rejects an unauthenticated webhook register', async ({ request }) => {
    const result = await tryRequest(request, WEBHOOKS_PATH, {
      method: 'POST',
      data: { url: PUBLIC_HTTPS_URL },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!result) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    expect([401, 403]).toContain(result.response.status());
  });

  test('rejects SSRF / non-https webhook targets (400)', async ({ request }) => {
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    const token = await tokenOrSkip();
    if (!token) return;

    // Validation (400) runs BEFORE the Growth+ gate (402), so these are 400 regardless of the tenant's plan.
    for (const { url, why } of REJECTED_TARGETS) {
      const res = await tryRequest(request, WEBHOOKS_PATH, { method: 'POST', data: { url }, headers: jsonAuth(token) });
      expect(res, `register(${url})`).not.toBeNull();
      expect(res!.response.status(), `${url} (${why}) should be rejected 400; body=${await res!.response.text()}`).toBe(400);
    }
  });

  test('registers a public https webhook, shows the secret once + never in the list, then revokes (Growth+), else 402 gate', async ({ request }) => {
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL}`);
      return;
    }
    const token = await tokenOrSkip();
    if (!token) return;

    const registered = await tryRequest(request, WEBHOOKS_PATH, {
      method: 'POST',
      data: { url: PUBLIC_HTTPS_URL },
      headers: jsonAuth(token),
    });
    expect(registered).not.toBeNull();
    const status = registered!.response.status();
    if (status === PAYMENT_REQUIRED) {
      test.skip(true, 'Webhook register is Growth+ gated for this tenant — 402 gate proven (see ichnos-billing.spec.ts)');
      return;
    }
    expect(status, await registered!.response.text()).toBe(201);
    const created = (await registered!.response.json()) as RegisteredWebhookResult;
    expect(created.id).toBeTruthy();
    expect(created.url).toBe(PUBLIC_HTTPS_URL);
    // The signing secret is returned ONCE here (used to verify the Ichnos-Signature header on each delivery).
    expect(created.signingSecret, 'signing secret returned on register').toBeTruthy();

    // GET list — a non-secret summary; the signing secret must NEVER appear (not as a field, not in the raw body).
    const listed = await tryRequest(request, WEBHOOKS_PATH, { headers: bearer(token) });
    expect(listed!.response.status()).toBe(200);
    const listText = await listed!.response.text();
    expect(listText).not.toContain(created.signingSecret);
    expect(listText.toLowerCase()).not.toContain('signingsecret');
    const summaries = JSON.parse(listText) as WebhookSummaryDto[];
    const mine = summaries.find((w) => w.id === created.id);
    expect(mine, 'registered webhook appears in the list').toBeDefined();
    expect(mine!.active).toBe(true);

    // Revoke → 204; revoking again → 404 (no longer the tenant's active endpoint).
    const revoked = await tryRequest(request, `${WEBHOOKS_PATH}/${created.id}`, { method: 'DELETE', headers: bearer(token) });
    expect(revoked!.response.status()).toBe(204);
    const revokedAgain = await tryRequest(request, `${WEBHOOKS_PATH}/${created.id}`, { method: 'DELETE', headers: bearer(token) });
    expect(revokedAgain!.response.status()).toBe(404);
  });

  test('both-channels delivery (webhook receipt + alert email) is infra-gated', async ({ request }) => {
    // Full both-channels verification needs (a) a PUBLIC https webhook sink the runner can poll for receipt
    // (ICHNOS_WEBHOOK_SINK_URL) AND (b) an IMAP/Mailpit inbox + SMTP configured so the alert EMAIL can be
    // asserted (ICHNOS_IMAP_HOST/USER/PASSWORD), AND (c) a planted tier-delta to actually FIRE an alert
    // (a dataset-diff seeding hook — the same hook the monitoring spec's ack test documents as missing).
    // This is the M3 exit item. Until all three exist, this test skips rather than false-pass.
    if (!ICHNOS_WEBHOOK_SINK_URL || !hasEmailInboxConfigured()) {
      test.skip(
        true,
        'Both-channels delivery E2E is infra-gated: set ICHNOS_WEBHOOK_SINK_URL (public https sink) + ICHNOS_IMAP_HOST/USER/PASSWORD, and a dataset-diff seeding hook to plant an alert.',
      );
      return;
    }
    const token = await tokenOrSkip();
    if (!token) return;

    // When a sink IS configured we can still assert the delivery-status side-effect surface: the webhook
    // summary exposes lastDeliveryStatus (the AlertDelivery outbox state). Registering + reading it back
    // proves the field is wired even before a real delta fires (which would flip it from null to a status).
    const registered = await tryRequest(request, WEBHOOKS_PATH, {
      method: 'POST',
      data: { url: ICHNOS_WEBHOOK_SINK_URL },
      headers: jsonAuth(token),
    });
    if (registered!.response.status() === PAYMENT_REQUIRED) {
      test.skip(true, 'Webhook register is Growth+ gated for this tenant — cannot exercise delivery');
      return;
    }
    expect(registered!.response.status(), await registered!.response.text()).toBe(201);
    const created = (await registered!.response.json()) as RegisteredWebhookResult;

    const listed = await tryRequest(request, WEBHOOKS_PATH, { headers: bearer(token) });
    const summaries = (await listed!.response.json()) as WebhookSummaryDto[];
    const mine = summaries.find((w) => w.id === created.id);
    expect(mine, 'webhook present').toBeDefined();
    // lastDeliveryStatus is a first-class field (null until a delivery is attempted). Asserting it is present
    // in the contract is the most that is deterministic without a planted alert firing a real delivery.
    expect(Object.prototype.hasOwnProperty.call(mine, 'lastDeliveryStatus')).toBeTruthy();

    // Clean up so repeated runs don't accumulate sink registrations.
    await tryRequest(request, `${WEBHOOKS_PATH}/${created.id}`, { method: 'DELETE', headers: bearer(token) });
  });
});

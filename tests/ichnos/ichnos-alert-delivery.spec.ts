// @api tier — M3 both-channels alert-DELIVERY E2E. Codifies the flow proven live on staging: a monitored
// address worsens (Clear→Direct) → an Alert fires → the AlertDispatchHostedService fans out to BOTH channels:
// (a) an email via Maddy (from noreply@dloizides.com) to the tenant's alertEmail, and (b) an HMAC-signed
// webhook (Ichnos-Signature header) to the tenant's registered endpoint.
//
// It runs AUTHORITATIVELY only in-cluster (the un-suspended nightly runner), where: the ichnos-api service is
// reachable, an ichnos tenant token is available, the seeded tenant is on Growth+ (so monitoring + webhooks are
// unlocked), the test-only POST /v1/testing/seed-alert enabler is on (Testing:AllowSeedAlert=true), and the
// SSRF-guard allowlist permits the ONE in-cluster sink. From the dev PC every one of those is unreachable, so
// the spec `test.skip`s gracefully at the first gate it fails.
//
// What is ASSERTED vs GRACEFULLY-SKIPPED:
//   • Service unreachable / no token .......... test.skip (dev PC — cannot reach WireGuard-only staging).
//   • Monitored-address add returns 402 ....... test.skip: the tenant is NOT Growth+ — the plan gate is proven
//                                               (same opportunistic pattern as ichnos-monitoring/webhooks specs).
//   • seed-alert returns 404 .................. test.skip: Testing:AllowSeedAlert is off in this env (inert hook).
//   • WEBHOOK channel (always, in-cluster) .... poll GET /v1/webhooks until lastDeliveryStatus === 'delivered'
//                                               (bounded) — proves the HMAC webhook dispatched + the sink 2xx'd.
//   • EMAIL channel .......................... asserted via IMAP when ICHNOS_IMAP_* creds are present (the alert
//                                               email lands at the bot mailbox, subject/body name the address +
//                                               the tier change); otherwise test.skip with a note that email
//                                               delivery is proven at the DISPATCH level (Maddy accepted the send)
//                                               and IMAP creds are needed only to assert RECEIPT.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { setTimeout as delay } from 'timers/promises';
import {
  CLEAR_BTC_ADDRESS,
  ICHNOS_API_URL,
  PAYMENT_REQUIRED,
  bearer,
  getIchnosToken,
  jsonAuth,
  tryRequest,
} from './ichnos-helpers.js';
import {
  ICHNOS_ALERT_EMAIL,
  loadIchnosMailboxConfig,
  resolveIchnosWebhookSinkUrl,
} from './ichnos-alert-helpers.js';
import { SharedBotMailbox } from '../../helpers/sharedMailbox.js';

const MONITORED_PATH = '/v1/monitored-addresses';
const NOTIFY_PATH = '/v1/monitoring/notification-settings';
const WEBHOOKS_PATH = '/v1/webhooks';
const SEED_ALERT_PATH = '/v1/testing/seed-alert';

const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

// Bounded webhook-delivery poll: the AlertDispatchHostedService runs on a background cycle, so allow ~60s for a
// Pending → Delivered transition (dispatch cycle + HMAC POST + the sink's 2xx echo). A timeout fails the assert.
const WEBHOOK_POLL_ATTEMPTS = 30;
const WEBHOOK_POLL_INTERVAL_MS = 2_000;
const DELIVERED = 'delivered';
const FAILED = 'failed';

// The alert email is a couple of hops behind the webhook (SMTP submit + Maddy queue + DKIM), so give IMAP a
// wider window than the shared 60s default.
const EMAIL_TIMEOUT_MS = 120_000;

interface MonitoredAddressDto {
  id: string;
  chain: string;
  address: string;
}
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
interface SeededAlertResult {
  alertId: string;
  previousTier: string;
  newTier: string;
}

test.describe('Ichnos alert delivery @ichnos-api', () => {
  test('worsening alert fans out to BOTH channels — HMAC webhook delivered + alert email received', async ({
    request,
  }) => {
    // (0) Reachability + token — dev PC can't reach WireGuard-only staging; skip cleanly there.
    const reachable = await tryRequest(request, '/health/ready');
    if (!reachable) {
      test.skip(true, `Service not available at ${ICHNOS_API_URL} — this runs in-cluster on the nightly runner`);
      return;
    }
    const token = await getIchnosToken();
    if (!token) {
      test.skip(true, 'No ichnos tenant token (set ICHNOS_TEST_USERNAME/PASSWORD + ICHNOS_E2E_CLIENT_SECRET)');
      return;
    }

    let monitoredAddressId: string | null = null;
    let webhookId: string | null = null;
    let mailboxUid: number | null = null;
    const mailboxConfig = loadIchnosMailboxConfig();

    try {
      // (1) Add a monitored address — Growth+ gated. A 402 IS the gate assertion; skip the delivery flow.
      const added = await tryRequest(request, MONITORED_PATH, {
        method: 'POST',
        data: { ...CLEAR_BTC_ADDRESS, label: 'e2e-alert-delivery' },
        headers: jsonAuth(token),
      });
      expect(added).not.toBeNull();
      const addStatus = added!.response.status();
      if (addStatus === PAYMENT_REQUIRED) {
        test.skip(true, 'Monitored-address add is Growth+ gated for this tenant — 402 gate proven; delivery flow needs a Growth+ tenant');
        return;
      }
      expect(addStatus, await added!.response.text()).toBe(HTTP_CREATED);
      const monitored = (await added!.response.json()) as MonitoredAddressDto;
      monitoredAddressId = monitored.id;
      expect(monitoredAddressId).toBeTruthy();

      // (2) Point notification settings at an E2E-readable mailbox: notifyOn=worsening (a Clear→Direct fires) +
      //     emailEnabled=true + alertEmail = the bot mailbox (or ICHNOS_ALERT_EMAIL override).
      const settings = await tryRequest(request, NOTIFY_PATH, {
        method: 'PUT',
        data: { notifyOn: 'worsening', alertEmail: ICHNOS_ALERT_EMAIL, emailEnabled: true },
        headers: jsonAuth(token),
      });
      expect(settings!.response.status(), await settings!.response.text()).toBe(HTTP_OK);

      // (3) Register the in-cluster webhook sink (allowlisted by the SSRF guard). Capture the signing secret —
      //     it is returned ONCE and is what the sink verifies on the Ichnos-Signature header.
      const sinkUrl = resolveIchnosWebhookSinkUrl();
      const registered = await tryRequest(request, WEBHOOKS_PATH, {
        method: 'POST',
        data: { url: sinkUrl },
        headers: jsonAuth(token),
      });
      expect(registered).not.toBeNull();
      const regStatus = registered!.response.status();
      if (regStatus === PAYMENT_REQUIRED) {
        test.skip(true, 'Webhook register is Growth+ gated for this tenant — 402 gate proven; delivery flow needs a Growth+ tenant');
        return;
      }
      expect(regStatus, await registered!.response.text()).toBe(HTTP_CREATED);
      const webhook = (await registered!.response.json()) as RegisteredWebhookResult;
      webhookId = webhook.id;
      expect(webhook.signingSecret, 'signing secret returned once on register').toBeTruthy();
      expect(webhook.url).toBe(sinkUrl);

      // (4) Fire the alert on demand: seed a WORSENING Clear→Direct alert for the monitored address. A 404 means
      //     Testing:AllowSeedAlert is off in this env (the hook is inert) → skip with a clear note.
      const seeded = await tryRequest(request, SEED_ALERT_PATH, {
        method: 'POST',
        data: { monitoredAddressId, chain: CLEAR_BTC_ADDRESS.chain, address: CLEAR_BTC_ADDRESS.address },
        headers: jsonAuth(token),
      });
      expect(seeded).not.toBeNull();
      const seedStatus = seeded!.response.status();
      if (seedStatus === HTTP_NOT_FOUND) {
        test.skip(true, 'seed-alert returned 404 — Testing:AllowSeedAlert is not enabled in this env (inert test hook); cannot fire an alert on demand');
        return;
      }
      expect(seedStatus, await seeded!.response.text()).toBe(HTTP_CREATED);
      const seedResult = (await seeded!.response.json()) as SeededAlertResult;
      expect(seedResult.alertId).toBeTruthy();
      expect(seedResult.newTier).toBeTruthy();

      // (5) WEBHOOK channel — poll the management list until the endpoint's lastDeliveryStatus flips to
      //     'delivered'. That flip is the dispatch worker's proof that it built + HMAC-signed the payload and the
      //     sink returned 2xx (a Failed row would be retried; only Delivered is terminal-success).
      const finalStatus = await pollWebhookDeliveryStatus(request, token, webhookId);
      expect(
        finalStatus,
        `webhook lastDeliveryStatus never reached '${DELIVERED}' (last='${String(finalStatus)}') within ${String(WEBHOOK_POLL_ATTEMPTS * WEBHOOK_POLL_INTERVAL_MS)}ms — the HMAC webhook did not dispatch or the sink rejected it`,
      ).toBe(DELIVERED);

      // (6) EMAIL channel — assert real receipt only when an IMAP inbox is configured. Otherwise the email side is
      //     proven at the DISPATCH level (Maddy accepted the send) and this receipt assertion is skipped.
      if (!mailboxConfig) {
        test.skip(true, 'Alert email delivery is proven at dispatch (Maddy accepted the send); set ICHNOS_IMAP_HOST/USER/PASSWORD to assert IMAP RECEIPT of the alert email');
        return;
      }
      const mailbox = new SharedBotMailbox(mailboxConfig, { timeoutMs: EMAIL_TIMEOUT_MS });
      const email = await mailbox.waitForMessageTo(ICHNOS_ALERT_EMAIL, {
        subjectIncludes: CLEAR_BTC_ADDRESS.address,
        preferNewest: true,
      });
      mailboxUid = email.uid;
      // Subject shape: "Monitoring alert: {address} moved {previous}→{new}". Assert it names the address AND the
      // worsening tier change the seed created.
      const haystack = `${email.subject} ${email.bodyText} ${email.bodyHtml ?? ''}`.toLowerCase();
      expect(email.subject).toContain(CLEAR_BTC_ADDRESS.address);
      expect(haystack, 'alert email names the new (worsened) tier').toContain(seedResult.newTier.toLowerCase());
      expect(haystack, 'alert email names the previous tier').toContain(seedResult.previousTier.toLowerCase());
    } finally {
      // (7) Best-effort cleanup so repeated nightly runs don't accumulate state or leave the shared mailbox dirty.
      if (webhookId) {
        await tryRequest(request, `${WEBHOOKS_PATH}/${webhookId}`, { method: 'DELETE', headers: bearer(token) }).catch(
          () => undefined,
        );
      }
      if (monitoredAddressId) {
        await tryRequest(request, `${MONITORED_PATH}/${monitoredAddressId}`, {
          method: 'DELETE',
          headers: bearer(token),
        }).catch(() => undefined);
      }
      if (mailboxConfig && mailboxUid !== null) {
        await new SharedBotMailbox(mailboxConfig).expungeMessages([mailboxUid]).catch(() => undefined);
      }
    }
  });
});

/**
 * Poll the tenant's webhook list until the target endpoint's lastDeliveryStatus becomes 'delivered', or the
 * bounded budget elapses. Returns the last observed status (null if never attempted / not found) so the caller
 * can assert + report it. A transient 'failed' is not terminal (the worker retries), so we keep polling.
 */
async function pollWebhookDeliveryStatus(
  request: APIRequestContext,
  token: string,
  webhookId: string,
): Promise<string | null> {
  let last: string | null = null;
  for (let attempt = 0; attempt < WEBHOOK_POLL_ATTEMPTS; attempt++) {
    const listed = await tryRequest(request, WEBHOOKS_PATH, { headers: bearer(token) });
    if (listed && listed.response.status() === HTTP_OK) {
      const summaries = (await listed.response.json()) as WebhookSummaryDto[];
      const mine = summaries.find((w) => w.id === webhookId);
      last = mine?.lastDeliveryStatus ?? last;
      if (last === DELIVERED) return last;
      if (last === FAILED) {
        // Not terminal on its own (bounded retries may still succeed), but surface it in the reported value.
        last = FAILED;
      }
    }
    await delay(WEBHOOK_POLL_INTERVAL_MS);
  }
  return last;
}

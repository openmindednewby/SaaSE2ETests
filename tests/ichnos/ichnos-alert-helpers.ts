// M3 both-channels alert-delivery E2E helpers (dispatch fan-out: email via Maddy + HMAC webhook). Kept in a
// focused sibling module so ichnos-helpers.ts stays under the max-file-lines budget; imported only by
// ichnos-alert-delivery.spec.ts.
import type { MailboxConfig } from '../../helpers/sharedMailbox.js';

/**
 * The E2E-readable mailbox the alert EMAIL is sent to. `notifyOn=worsening` +
 * `emailEnabled=true` writes this into notification-settings.alertEmail. Defaults to the shared
 * `e2e-kefi-bot@dloizides.com` Maddy bot mailbox (the same inbox the kefi #185 IMAP canary + the OTP-login
 * suite poll); override via ICHNOS_ALERT_EMAIL.
 */
export const ICHNOS_ALERT_EMAIL =
  process.env.ICHNOS_ALERT_EMAIL?.trim() || 'e2e-kefi-bot@dloizides.com';

/**
 * The ONE in-cluster webhook sink the Ichnos SSRF-guard allowlist permits (returns 200 and echoes the request
 * incl. the `Ichnos-Signature` header). Registering it as a tenant webhook lets the dispatch worker deliver over
 * the cluster network and flip the endpoint's `lastDeliveryStatus` to `delivered`. Reachable ONLY in-cluster
 * (the un-suspended nightly runner) — the dev PC cannot resolve the `.svc.cluster.local` name. Override via
 * ICHNOS_WEBHOOK_SINK_URL.
 */
export const ICHNOS_WEBHOOK_SINK_DEFAULT_URL =
  'http://ichnos-webhook-sink.dloizides.svc.cluster.local:8080/hook';

/** Resolve the alert-delivery webhook sink URL (env ICHNOS_WEBHOOK_SINK_URL, else the in-cluster default). */
export function resolveIchnosWebhookSinkUrl(): string {
  const envUrl = process.env.ICHNOS_WEBHOOK_SINK_URL;
  return envUrl && envUrl.trim() ? envUrl.trim() : ICHNOS_WEBHOOK_SINK_DEFAULT_URL;
}

/** IMAP-TLS default port (STARTTLS on 143 is auto-applied by the shared mailbox client). */
const IMAP_TLS_PORT = 993;

/**
 * Build an IMAP MailboxConfig for the alert-email receipt assertion from ICHNOS_IMAP_HOST/USER/PASSWORD
 * (falling back to the generic IMAP_* names), or null when any is unset — in which case the email-channel
 * assertion `test.skip`s (email delivery is still proven at the dispatch level: Maddy accepted the send). Port
 * defaults to 993 (IMAP-TLS); override via ICHNOS_IMAP_PORT / IMAP_PORT.
 */
export function loadIchnosMailboxConfig(): MailboxConfig | null {
  const host = process.env.ICHNOS_IMAP_HOST?.trim() || process.env.IMAP_HOST?.trim();
  const user = process.env.ICHNOS_IMAP_USER?.trim() || process.env.IMAP_USER?.trim();
  const password = process.env.ICHNOS_IMAP_PASSWORD?.trim() || process.env.IMAP_PASSWORD?.trim();
  if (!host || !user || !password) return null;

  const portRaw = process.env.ICHNOS_IMAP_PORT?.trim() || process.env.IMAP_PORT?.trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : IMAP_TLS_PORT;
  return { host, port, user, password, secure: port === IMAP_TLS_PORT };
}

/**
 * Mailbox plumbing for the Poueni reset-password E2E. Reuses the shared
 * `KefiMailbox` IMAP client + the same bot mailbox (`e2e-kefi-bot@dloizides.com`)
 * via plus-addressing: `e2e-kefi-bot+poueni-{id}@dloizides.com` is delivered to
 * the same inbox unchanged, so no new mailbox provisioning is needed. We filter
 * by the per-run plus-address at read time.
 *
 * Two extractors because Poueni's verify + reset emails use distinct link
 * shapes: verify → `{api}/v1/public/verify?token=...`, reset →
 * `{marketing}/reset-password?token=...`.
 */
import {
  KefiMailbox,
  loadKefiMailboxConfig,
  type CapturedEmail,
} from '../kefi/kefiMailboxClient.js';

export { KefiMailbox as PoueniMailbox };

/** Build the IMAP config from the shared E2E_KEFI_MAILBOX_* env vars. */
export function loadPoueniMailboxConfig(): ReturnType<typeof loadKefiMailboxConfig> {
  return loadKefiMailboxConfig();
}

/**
 * A unique plus-addressed recipient on the shared bot mailbox. Lowercased
 * because the signup endpoint lowercases the email before storing/looking up,
 * and KC usernames are the email — keeping the whole chain lowercase avoids a
 * case-mismatch login miss.
 */
export function newPoueniCanaryEmail(): string {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `e2e-kefi-bot+poueni-${id}@dloizides.com`.toLowerCase();
}

/** Pull the verify URL (`.../v1/public/verify?token=...`) out of an email. */
export function extractPoueniVerifyUrl(email: CapturedEmail): string | null {
  const body = email.bodyHtml ?? email.bodyText;
  const matches = body.match(/https?:\/\/[^\s"<>]*\/v1\/public\/verify\?token=[^\s"<>]+/gi);
  return decodeHtmlEntities(matches?.[0]) ?? null;
}

/** Pull the reset URL (`.../reset-password?token=...`) out of an email. */
export function extractPoueniResetUrl(email: CapturedEmail): string | null {
  const body = email.bodyHtml ?? email.bodyText;
  const matches = body.match(/https?:\/\/[^\s"<>]*\/reset-password\?token=[^\s"<>]+/gi);
  return decodeHtmlEntities(matches?.[0]) ?? null;
}

/** Minimal entity decode — email HTML escapes `&` in query strings as `&amp;`. */
function decodeHtmlEntities(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/&amp;/g, '&');
}

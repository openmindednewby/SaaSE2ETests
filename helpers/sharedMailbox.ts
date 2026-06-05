/**
 * Shared E2E bot-mailbox client.
 *
 * The `e2e-kefi-bot@dloizides.com` Maddy mailbox (plus-addressing:
 * `e2e-kefi-bot+anything@dloizides.com` all deliver to it) is the single
 * shared inbox the remote E2E suites poll. It was introduced for the kefi
 * tenant-lifecycle canary; the OTP-login suite is its second consumer, so the
 * generic IMAP poller is surfaced here under a product-neutral name (the
 * underlying implementation still lives in `kefi/kefiMailboxClient` — a full
 * file move is deferred to avoid churning the kefi specs).
 */
export {
  KefiMailbox as SharedBotMailbox,
  loadKefiMailboxConfig as loadSharedBotMailboxConfig,
  type MailboxConfig,
  type CapturedEmail,
} from './kefi/kefiMailboxClient.js';

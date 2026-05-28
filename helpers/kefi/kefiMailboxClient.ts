/**
 * IMAP client for the Phase B Kefi tenant-lifecycle E2E. Polls the shared
 * `e2e-kefi-bot@dloizides.com` mailbox for the per-run verification email
 * (plus-addressed: `e2e-kefi-bot+e2c-{canaryId}@dloizides.com`), extracts
 * the verify URL, and optionally cleans up read messages.
 *
 * Why poll vs IMAP IDLE: poll is simpler + bounded, and Maddy's tail
 * latency on submission → INBOX is under a second on prod. A 60s default
 * window with 2s polls absorbs the SMTP queue + DKIM signing.
 *
 * Why the shared mailbox + plus-addressing instead of one mailbox per run:
 * decision #9 in the plan. Maddy delivers `foo+anything@domain` to `foo`
 * unchanged, so multiple parallel runs filter by canary id at read time
 * without any provisioning churn between runs.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { ImapFlow, type FetchMessageObject } from 'imapflow';

const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** TLS required when port=993; STARTTLS auto-applied for 143. */
  secure?: boolean;
}

export interface KefiMailboxOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface CapturedEmail {
  /** IMAP UID. Used to expunge after parsing. */
  uid: number;
  subject: string;
  to: string;
  bodyText: string;
  bodyHtml?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[kefiMailboxClient] Required env var ${name} is unset. Add it to .env.<target>.secrets.`,
    );
  }
  return value;
}

export function loadKefiMailboxConfig(): MailboxConfig {
  const port = Number.parseInt(requireEnv('E2E_KEFI_MAILBOX_PORT'), 10);
  return {
    host: requireEnv('E2E_KEFI_MAILBOX_HOST'),
    port,
    user: requireEnv('E2E_KEFI_MAILBOX_USER'),
    password: requireEnv('E2E_KEFI_MAILBOX_PASSWORD'),
    secure: port === 993,
  };
}

/**
 * Connect, poll INBOX until a message addressed to `to` arrives (or the
 * timeout elapses), return the first match. Caller is responsible for
 * calling `expungeMessages` if they want the inbox cleaned.
 */
export class KefiMailbox {
  private readonly config: MailboxConfig;
  private readonly options: Required<KefiMailboxOptions>;

  constructor(config: MailboxConfig, options: KefiMailboxOptions = {}) {
    this.config = config;
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_MS,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Wait for the first message whose To-header contains the given address
   * substring. The match is `includes`, not exact-equals, because IMAP
   * envelope `to` can be `"Foo" <foo@bar>` etc.
   */
  async waitForMessageTo(to: string): Promise<CapturedEmail> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure ?? this.config.port === 993,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const deadline = Date.now() + this.options.timeoutMs;

    try {
      while (Date.now() < deadline) {
        const found = await this.findMatchingMessage(client, to);
        if (found) return found;
        await delay(this.options.pollIntervalMs);
      }
      throw new Error(
        `[kefiMailbox] Timed out after ${this.options.timeoutMs}ms waiting for message to ${to}`,
      );
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }
  }

  /**
   * Expunge specific UIDs from INBOX. Safe to call after `waitForMessageTo`
   * — leaves the shared mailbox clean for the next run.
   */
  async expungeMessages(uids: number[]): Promise<void> {
    if (uids.length === 0) return;
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure ?? this.config.port === 993,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageFlagsAdd(uids.map(String).join(','), ['\\Deleted'], { uid: true });
      await client.messageDelete(uids.map(String).join(','), { uid: true });
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }
  }

  private async findMatchingMessage(client: ImapFlow, to: string): Promise<CapturedEmail | null> {
    // Fetch unseen messages with full source — small inbox + a single
    // canary in flight means this is cheap. `seen: false` to avoid
    // re-processing messages a previous run already touched.
    for await (const msg of client.fetch({ seen: false }, { source: true, envelope: true })) {
      const captured = extractCapturedEmail(msg);
      if (!captured) continue;
      if (captured.to.includes(to)) {
        return captured;
      }
    }
    return null;
  }
}

function extractCapturedEmail(msg: FetchMessageObject): CapturedEmail | null {
  if (!msg.envelope || !msg.source || msg.uid === undefined) return null;
  const env = msg.envelope;
  const toList = (env.to ?? [])
    .map(addr => (addr.name ? `${addr.name} <${addr.address}>` : addr.address ?? ''))
    .join(', ');
  const source = msg.source.toString('utf8');

  return {
    uid: msg.uid,
    subject: env.subject ?? '',
    to: toList,
    bodyText: extractBodyText(source),
    bodyHtml: extractBodyHtml(source),
  };
}

/**
 * Extract verification URL from email body. Matches the first https://
 * URL containing `/public/verify` or `/verify` (both shapes are valid
 * future endpoints; today the kefi flow uses TenantService's
 * `/api/v1/auth/verify-email?token=...`).
 */
export function extractVerifyUrl(email: CapturedEmail): string | null {
  const body = email.bodyHtml ?? email.bodyText;
  const matches = body.match(/https?:\/\/[^\s"<>]+verify[^\s"<>]*/gi);
  return matches?.[0] ?? null;
}

function extractBodyText(source: string): string {
  // Very simple: find the text/plain part if MIME-multipart, else return
  // the whole source. Robust enough for the canary verify email which
  // we control (it's a single short HTML template, with a plain-text
  // alternate).
  const textPart = source.match(/Content-Type:\s*text\/plain[^]*?\r?\n\r?\n([^]*?)(?:\r?\n--|\r?\n\r?\nContent-Type:|$)/i);
  return textPart?.[1] ?? source;
}

function extractBodyHtml(source: string): string | undefined {
  const htmlPart = source.match(/Content-Type:\s*text\/html[^]*?\r?\n\r?\n([^]*?)(?:\r?\n--|\r?\n\r?\nContent-Type:|$)/i);
  return htmlPart?.[1];
}


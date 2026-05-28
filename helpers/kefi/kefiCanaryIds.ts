/**
 * Canary-id helpers for the Phase B Kefi tenant-lifecycle E2E.
 *
 * The Kefi cleanup endpoint (DELETE /api/v1/internal/canary-cleanup) takes
 * `canaryId={8 lowercase hex}` and sweeps every Tenant whose slug starts
 * with `e2c-{canaryId}-` plus its KC user, Ingress, Certificate, and TLS
 * Secret. This module mints the id + derives the per-run identifiers the
 * spec needs (slug, tenant-name input for signup, plus-addressed email).
 *
 * Intentionally distinct from `helpers/canary-prefix.ts`:
 *   - That module exposes the Phase-2 platform-wide `e2ec-{runId8}-` prefix
 *     used by the 6 existing backend slices' cleanup endpoints.
 *   - This module is Kefi-only with the shorter `e2c-{canaryId}-` shape
 *     (decision #4 + #9 in the plan doc).
 *
 * The Kefi canary id is independent from the Phase-2 runId by design — the
 * Kefi cleanup endpoint doesn't take a UUID, and the cleanup target
 * resources (KefiDB + kefi realm + per-tenant K8s) are decoupled from the
 * legacy 6-service sweep. Phase E may unify them.
 */

import * as crypto from 'node:crypto';

const CANARY_ID_BYTES = 4;
const CANARY_SLUG_PREFIX_TEMPLATE = 'e2c-{0}-';

export interface KefiCanaryContext {
  /** 8 lowercase hex chars — what the cleanup endpoint's `canaryId` query takes. */
  canaryId: string;
  /** Slug prefix the cleanup endpoint matches against (`e2c-{canaryId}-`). */
  slugPrefix: string;
  /** Tenant-name to POST to /api/v1/public/signup. Kebab-cases into a slug starting with `slugPrefix`. */
  tenantName: string;
  /** Plus-addressed bot inbox the verify + welcome emails land in. */
  email: string;
  /** Strong password for the new tenant owner. Long, mixed-case, single-line. */
  password: string;
}

/**
 * Mint a fresh per-run context. `email` uses the shared bot mailbox with the
 * canary id in the plus-address, so multiple parallel runs never see each
 * other's mail (each run filters by canary-id when polling IMAP).
 */
export function newCanaryContext(opts?: { mailbox?: string }): KefiCanaryContext {
  const canaryId = crypto.randomBytes(CANARY_ID_BYTES).toString('hex');
  const slugPrefix = CANARY_SLUG_PREFIX_TEMPLATE.replace('{0}', canaryId);
  const mailbox = opts?.mailbox ?? process.env.E2E_KEFI_MAILBOX_USER ?? 'e2e-kefi-bot@dloizides.com';
  const [localPart, domain] = mailbox.split('@');
  if (!localPart || !domain) {
    throw new Error(`[kefiCanaryIds] Malformed mailbox address: ${mailbox}`);
  }
  return {
    canaryId,
    slugPrefix,
    tenantName: `${slugPrefix}Canary Tenant`,
    email: `${localPart}+${slugPrefix.replace(/-$/, '')}@${domain}`,
    // 16 random bytes → 22 char base64; capital + digits + special-by-base64
    // satisfies KC's default password policy.
    password: `K!${crypto.randomBytes(16).toString('base64').replace(/[/+=]/g, '')}`,
  };
}

/** Assert a string matches the 8-hex shape the Kefi cleanup endpoint accepts. */
export function isValidCanaryId(value: string): boolean {
  return /^[0-9a-f]{8}$/.test(value);
}

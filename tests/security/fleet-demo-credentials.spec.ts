/**
 * FLEET-WIDE credential-publication guard — no credential a portal PUBLISHES may be a seeded
 * privileged-account password, on ANY portal.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * `GET /bff/config` publishes demo credentials to anonymous visitors ON PURPOSE, so an evaluator
 * can try a product without a sales call. That is a good feature. It is also a loaded gun aimed
 * at the seeder.
 *
 * The Keycloak seeder (scripts/seed-realm-users.ps1) sets the password of every account listed in
 * `realms.config.json`'s `testUsers[]`. Those accounts are privileged — `superUser`, `aml-admin`,
 * `zygos-admin`, `agora-merchant-*`, `ichnos-admin`. If a demo user is ever "tidied" into
 * `testUsers[]`, the next re-provision resets it to a seeded password, and the portal then
 * PUBLISHES a working privileged credential to the internet.
 *
 * 🔴 This is not hypothetical. On 2026-07-19 a measurement found ONE shared password
 * authenticating ~15 seeded accounts across 9 PRODUCTION realms, and that same literal was
 * committed in plaintext to two PUBLIC GitHub repositories. The seeder now derives a DISTINCT
 * password per realm, which shrinks the blast radius of the next disclosure from "the estate" to
 * "one realm" — but it does nothing to stop a demo user being swept into `testUsers[]`. That is
 * what this file is for.
 *
 * ── Why it is fleet-wide ──────────────────────────────────────────────────────────────────────
 *
 * `tests/zygos/zygos-public-surface.spec.ts` proved this pattern works, on ONE portal. We run
 * seven. A guard that covers a seventh of the fleet is a guard that reports green while six
 * portals carry the defect — and the six uncovered portals are exactly where nobody is looking.
 * This is the zygos assertion generalised; the zygos spec keeps its own richer marketing-site
 * cross-check, which is portal-specific and stays there.
 *
 * ── Why it asserts a LOGIN, not just string inequality ────────────────────────────────────────
 *
 * A string comparison alone passes the moment someone rotates the published value to a different
 * literal that happens to ALSO be a seeded password — and, more importantly, it cannot see the
 * case where the demo user itself was swept into `testUsers[]` under a different published
 * string. So each portal is also probed with the seeded password: it must be REJECTED. That
 * assertion fails closed and names the portal.
 *
 * A portal whose base URL is not configured SKIPS loudly rather than fails — but a portal that IS
 * configured and publishes no demo block is simply not publishing anything, which is safe, so it
 * passes with a note rather than failing.
 */
import { expect, test } from '@playwright/test';

import { resolveRealmPassword } from '../../helpers/realm-test-password.js';

interface Portal {
  readonly label: string;
  /** SPA origin; empty => skipped for this target. */
  readonly baseUrl: string;
  /** The Keycloak realm whose seeded accounts this portal authenticates against. */
  readonly realm: string;
}

/**
 * Every portal that serves a BFF. Keep this list in step with the fleet — a portal missing from
 * here is a portal with no guard, which is the exact hole this file was written to close.
 */
const PORTALS: readonly Portal[] = [
  { label: 'erevna-web', baseUrl: process.env.EREVNA_BASE_URL ?? '', realm: 'questioner' },
  { label: 'katalogos-web', baseUrl: process.env.KATALOGOS_BASE_URL ?? '', realm: 'onlinemenu' },
  { label: 'kefi-web', baseUrl: process.env.KEFI_WEB_URL ?? '', realm: 'kefi' },
  { label: 'agora-web', baseUrl: process.env.AGORA_WEB_URL ?? '', realm: 'agora' },
  { label: 'zygos-web', baseUrl: process.env.ZYGOS_WEB_URL ?? '', realm: 'zygos' },
  { label: 'ichnos-web', baseUrl: process.env.ICHNOS_WEB_URL ?? '', realm: 'ichnos' },
  { label: 'poueni-web', baseUrl: process.env.POUENI_WEB_URL ?? '', realm: 'poueni' },
];

interface BffConfig {
  registrationEnabled?: boolean;
  demo: { publishedUsername: string; publishedPassword: string } | null;
}

/**
 * Every password a seeded account in this realm could hold: the per-realm derived value AND the
 * legacy shared value. BOTH are checked, because a realm that has not yet been re-seeded still
 * carries the old shared password — and that is precisely the window in which this guard is most
 * needed.
 */
function seededPasswordsFor(realm: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const resolved = resolveRealmPassword(realm);
  if (resolved.password) out.push({ value: resolved.password, label: `seeded password for realm '${realm}' (${resolved.source})` });

  const legacy = process.env.TEST_USER_PASSWORD?.trim();
  if (legacy && legacy !== resolved.password) {
    out.push({ value: legacy, label: 'the LEGACY shared platform password ($TEST_USER_PASSWORD)' });
  }
  return out;
}

test.describe('Fleet demo-credential publication guard @security @api', () => {
  for (const portal of PORTALS) {
    test(`🔴 ${portal.label} does not publish a seeded privileged credential`, async ({ request }) => {
      test.skip(
        portal.baseUrl === '',
        `${portal.label}: base URL not configured for this target — NO GUARD IS RUNNING for this portal.`,
      );

      // A portal configured for this target but not actually listening is NOT a credential
      // finding — it is an environment fact, and uptime belongs to the smoke suite. Failing here
      // would make this guard red for a reason it does not measure, and a guard that is red for
      // unrelated reasons is a guard people learn to ignore. It skips LOUDLY instead.
      let res;
      try {
        res = await request.get(`${portal.baseUrl.replace(/\/+$/, '')}/bff/config`);
      } catch (err) {
        test.skip(
          true,
          `${portal.label}: ${portal.baseUrl} unreachable (${(err as Error).message.split('\n')[0]}) — NO GUARD RAN for this portal.`,
        );
        return;
      }
      // A portal without /bff/config predates Bff.AspNetCore 1.10.0 and therefore cannot publish
      // a demo credential at all. Nothing to guard; say so rather than failing.
      test.skip(res.status() === 404, `${portal.label}: no /bff/config endpoint — cannot publish credentials.`);
      expect(res.status(), `${portal.label}: GET /bff/config failed: ${await res.text()}`).toBe(200);

      const config = (await res.json()) as BffConfig;
      if (config.demo === null || config.demo === undefined) {
        // Publishing nothing is a safe state, not a failure.
        test.info().annotations.push({ type: 'notice', description: `${portal.label}: publishes no demo credentials.` });
        return;
      }

      const demo = config.demo;
      const candidates = seededPasswordsFor(portal.realm);
      expect(
        candidates.length,
        `${portal.label}: no seeded password resolvable for realm '${portal.realm}' — this guard would pass vacuously. Set KEYCLOAK_TEST_USER_SECRET.`,
      ).toBeGreaterThan(0);

      for (const candidate of candidates) {
        // (1) The cheap, unambiguous check.
        expect(
          demo.publishedPassword,
          `${portal.label} PUBLISHES ${candidate.label}. Any visitor to ${portal.baseUrl} now holds a privileged credential for realm '${portal.realm}'.`,
        ).not.toBe(candidate.value);

        // (2) The check that survives someone changing the published string: the demo ACCOUNT
        // itself must reject the seeded password. If it accepts, the demo user was swept into
        // realms.config.json's testUsers[] and the seeder reset it.
        const login = await request.post(`${portal.baseUrl.replace(/\/+$/, '')}/bff/login`, {
          headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1', Origin: portal.baseUrl },
          data: { username: demo.publishedUsername, password: candidate.value },
        });
        expect(
          login.status(),
          `${portal.label}: the PUBLISHED demo user '${demo.publishedUsername}' accepts ${candidate.label} ⇒ it was swept into realms.config.json testUsers[] and the seeder reset it. The credential this portal publishes is now a seeded privileged account.`,
        ).not.toBe(200);
      }
    });
  }
});

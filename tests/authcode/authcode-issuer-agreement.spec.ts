/**
 * FLEET-WIDE auth-code guard — a portal's FRONT channel and BACK channel must
 * name the SAME identity provider (@api tier, anonymous, no browser).
 *
 * ── The defect this pins (bff-agora, found 2026-08-19) ────────────────────────
 *
 *   ASPNETCORE_ENVIRONMENT=Staging  ->  appsettings.Staging.json supplies
 *                                       Bff:AuthCode:PublicAuthority = STAGING Keycloak
 *   manifest env (secretKeyRef)     ->  Bff:Keycloak:Authority       = PROD Keycloak
 *
 * .NET config precedence is base -> environment overlay -> env vars, so the
 * manifest env var overrode ONLY the back channel and manufactured a mismatch
 * out of two internally-consistent appsettings files. `manage.sh` then FORCES
 * `ASPNETCORE_ENVIRONMENT=Staging` on every `bff-*` deploy, so the manifest
 * saying "Production" is not what runs.
 *
 * ── Why it was invisible for 22 days ─────────────────────────────────────────
 *
 *  1. `BffAuthorityAgreementGuard` correctly REFUSED to start the pod — and
 *     Kubernetes kept the 22-day-old pod serving 200 the entire time. The public
 *     URL was green throughout. `kubectl rollout status` timing out was the only
 *     signal, and it scrolled past.
 *  2. Every login test in this repo is ROPC or the published demo credential:
 *     the SPA POSTs a password to `/bff/login` and THE BROWSER NEVER LEAVES THE
 *     APP ORIGIN. The front channel is never touched, so it can point at the
 *     wrong Keycloak — or at a host with no public DNS at all — and every suite
 *     stays green. (`reference_demo_ropc_masks_broken_authcode_login`.)
 *
 * A guard that only runs INSIDE the pod cannot be observed from outside, and a
 * guard nobody observes is indistinguishable from a pod that never started.
 * This spec is the outside observer.
 *
 * ── What it asserts, and what it deliberately does not ───────────────────────
 *
 * It compares the two halves of one deployment against EACH OTHER. It does not
 * pin an expected issuer per environment — that would relocate the assumption
 * instead of testing it, and would need editing every time an environment moves.
 * Differing URLs are fine and expected (public hostname vs in-cluster Service
 * name); only the ISSUERS must match.
 *
 * ── What this catches that the PRE-DEPLOY guard cannot (and vice versa) ──────
 *
 * `check-bff-authority-agreement.py` reads config statically before a deploy and
 * catches the crash-loop. This spec CANNOT catch that: a pod that is serving has
 * by definition already passed the in-process guard, so its two channels agree
 * AS THE POD SEES THEM. The two checks are complements, not duplicates:
 *
 *   pre-deploy (static) -> the pod will refuse to start
 *   this spec (runtime) -> the pod started, and the front channel it advertises
 *                          is nonetheless wrong FROM OUTSIDE
 *
 * The second is a real and separate class: `PublicAuthority` may resolve inside
 * the cluster and nowhere else (`staging.identity.dloizides.com` has no public
 * DNS), split-horizon DNS may point one name at two different servers, or the
 * guard may simply be absent on an older package — and in every one of those the
 * pod is healthy, the in-process guard is satisfied, and the login button is dead.
 *
 * ⚠️ Reading the results honestly: against `staging` the runner applies the
 * WireGuard host override (`*.staging.dloizides.com` -> 10.0.0.2), so "reachable"
 * there means reachable THROUGH THE TUNNEL, not from the public internet. Only
 * the `prod` target is a true outside observer.
 *
 * See `helpers/authcode-probe.ts` for the probe, and
 * `authcode-negative-control.spec.ts` for the fixture that proves it can fail.
 */
import { expect, test } from '@playwright/test';

import { AUTHCODE_PORTALS } from '../../helpers/authcode-agreement.js';
import { probeAuthCodeAgreement } from '../../helpers/authcode-probe.js';

test.describe('Auth-code front/back channel agreement @authcode @api @security', () => {
  for (const portal of AUTHCODE_PORTALS) {
    test(`🔴 ${portal.label} sends the browser to the provider it redeems codes at`, async ({ request }) => {
      test.skip(
        portal.baseUrl === '',
        `${portal.label}: base URL not configured for this target — NO GUARD IS RUNNING for this portal.`,
      );

      const probe = await probeAuthCodeAgreement(request, portal);

      if (probe.kind === 'skip') {
        // Loud, never folded into a pass: "could not check" must never read as
        // "checked and fine". That conflation is the whole failure mode here.
        test.skip(true, probe.reason);
        return;
      }

      if (probe.kind === 'fail') {
        // The reason carries the portal, both issuers and the fix, so the report
        // is actionable without opening the code.
        expect(probe.kind, probe.reason).toBe('ok');
      }

      expect(probe.kind).toBe('ok');
      if (probe.kind === 'ok') {
        test.info().annotations.push({
          type: 'notice',
          description: `${portal.label}: front and back both name ${probe.issuer} (authorize: ${probe.authorizeUrl.split('?')[0]}).`,
        });
      }
    });
  }
});

/**
 * NEGATIVE CONTROL for the auth-code agreement guard.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 *
 * Standing rule in this repo: a new guard is not done until you have WATCHED IT
 * FAIL. Every real find here came from a negative control. A one-off manual
 * mutation satisfies that once — but the guard then runs unattended for months,
 * and the day someone "simplifies" the issuer comparison, or the probe starts
 * fetching nothing and reporting agreement, the fleet spec goes green and stays
 * green. Green because everything is fine and green because the guard died look
 * identical from the outside.
 *
 * So the failure modes are pinned as tests. `authcode-issuer-agreement.spec.ts`
 * proves the fleet is healthy; this file proves the thing that measured it can
 * still say no. Both run `probeAuthCodeAgreement` — the SAME function, not a
 * re-implementation of its logic — against ephemeral in-process fixtures.
 *
 * ── What each case kills ──────────────────────────────────────────────────────
 *
 *   1. mismatch      -> the bff-agora defect itself. Kills any mutation that
 *                       drops or weakens the issuer comparison.
 *   2. agreement     -> the guard is not simply always-red (which would be
 *                       "passing" case 1 for the wrong reason).
 *   3. unreachable   -> a BFF serving without having confirmed its provider is a
 *                       finding, not a pass.
 *   4. no issuerStatus -> an un-upgraded BFF SKIPS loudly; it must never be
 *                       reported as verified.
 *   5. dead front    -> a front channel the browser cannot reach is a dead login
 *                       button even when the configured issuer would have matched.
 *   6. no passkey   -> the BFF advertises no passkey method, so there is no
 *                       anonymous front-channel navigation to probe => SKIP.
 *   7. 501          -> the front-channel endpoint refuses => SKIP. A SEPARATE
 *                       exit from case 6, and one that a mutation proved case 6
 *                       does not reach.
 *
 * Cases 4, 6 and 7 are the important set: they are the ways this guard could
 * quietly stop guarding anything at all while reporting success.
 */
import { expect, test } from '@playwright/test';

import { ISSUER_STATUS_RESOLVED, ISSUER_STATUS_UNREACHABLE } from '../../helpers/authcode-agreement.js';
import { probeAuthCodeAgreement } from '../../helpers/authcode-probe.js';
import { startBff, startIdp, withFixtures } from './authcode-fixture.js';

const REALM = 'agora';
/** Port 1 is privileged and never listening — a guaranteed connection refusal. */
const DEAD_ORIGIN = 'http://127.0.0.1:1';

function portalFor(baseUrl: string) {
  return { label: 'fixture-bff', baseUrl };
}

test.describe('Auth-code guard negative control @authcode @api', () => {
  test('1. a front/back issuer MISMATCH is reported as a failure, naming both', async ({ request }) => {
    const back = await startIdp(REALM);
    const front = await startIdp(REALM);
    await withFixtures([back, front], async () => {
      const bff = await startBff({
        backIssuer: back.issuer,
        issuerStatus: ISSUER_STATUS_RESOLVED,
        frontOrigin: front.baseUrl,
        realm: REALM,
      });
      await withFixtures([bff], async () => {
        const probe = await probeAuthCodeAgreement(request, portalFor(bff.baseUrl));
        expect(probe.kind, 'a mismatched pair must FAIL — this is the bff-agora defect').toBe('fail');
        if (probe.kind !== 'fail') return;
        expect(probe.reason).toContain('DIFFERENT identity providers');
        expect(probe.reason).toContain(front.issuer);
        expect(probe.reason).toContain(back.issuer);
      });
    });
  });

  test('2. one provider on both channels PASSES (the guard is not always-red)', async ({ request }) => {
    const idp = await startIdp(REALM);
    await withFixtures([idp], async () => {
      const bff = await startBff({
        backIssuer: idp.issuer,
        issuerStatus: ISSUER_STATUS_RESOLVED,
        frontOrigin: idp.baseUrl,
        realm: REALM,
      });
      await withFixtures([bff], async () => {
        const probe = await probeAuthCodeAgreement(request, portalFor(bff.baseUrl));
        expect(probe.kind, 'an agreeing pair must pass, or case 1 passes for the wrong reason').toBe('ok');
      });
    });
  });

  test('3. an unresolved back channel is a FAILURE, not a pass', async ({ request }) => {
    const idp = await startIdp(REALM);
    await withFixtures([idp], async () => {
      const bff = await startBff({
        backIssuer: null,
        issuerStatus: ISSUER_STATUS_UNREACHABLE,
        frontOrigin: idp.baseUrl,
        realm: REALM,
      });
      await withFixtures([bff], async () => {
        const probe = await probeAuthCodeAgreement(request, portalFor(bff.baseUrl));
        expect(probe.kind, 'serving without a confirmed provider is a finding').toBe('fail');
        if (probe.kind === 'fail') expect(probe.reason).toContain(ISSUER_STATUS_UNREACHABLE);
      });
    });
  });

  test('4. a BFF that publishes no issuerStatus SKIPS loudly — never "verified"', async ({ request }) => {
    const idp = await startIdp(REALM);
    await withFixtures([idp], async () => {
      const bff = await startBff({ backIssuer: null, frontOrigin: idp.baseUrl, realm: REALM });
      await withFixtures([bff], async () => {
        const probe = await probeAuthCodeAgreement(request, portalFor(bff.baseUrl));
        expect(probe.kind, 'an un-upgraded BFF is UNCHECKED, and must say so').toBe('skip');
        if (probe.kind === 'skip') expect(probe.reason).toContain('NO GUARD RAN');
      });
    });
  });

  test('5. a front channel the browser cannot reach FAILS even with a resolved back channel', async ({ request }) => {
    const idp = await startIdp(REALM);
    await withFixtures([idp], async () => {
      const bff = await startBff({
        backIssuer: idp.issuer,
        issuerStatus: ISSUER_STATUS_RESOLVED,
        frontOrigin: DEAD_ORIGIN,
        realm: REALM,
      });
      await withFixtures([bff], async () => {
        const probe = await probeAuthCodeAgreement(request, portalFor(bff.baseUrl));
        expect(probe.kind, 'a dead front channel is a dead login button').toBe('fail');
        if (probe.kind === 'fail') expect(probe.reason).toContain('UNREACHABLE');
      });
    });
  });

  test('6. a BFF advertising no passkey method SKIPS loudly — nothing to probe is not a pass', async ({ request }) => {
    const idp = await startIdp(REALM);
    await withFixtures([idp], async () => {
      const bff = await startBff({
        backIssuer: idp.issuer,
        issuerStatus: ISSUER_STATUS_RESOLVED,
        frontOrigin: idp.baseUrl,
        realm: REALM,
        advertisesPasskey: false,
      });
      await withFixtures([bff], async () => {
        const probe = await probeAuthCodeAgreement(request, portalFor(bff.baseUrl));
        expect(probe.kind, 'no probeable front channel => UNCHECKED, said out loud').toBe('skip');
        if (probe.kind === 'skip') expect(probe.reason).toContain('NO GUARD RAN');
      });
    });
  });

  test('7. a 501 from the front-channel endpoint SKIPS loudly — the OTHER unprobeable exit', async ({ request }) => {
    // Separate from case 6 on purpose. The probe gives up in two different places
    // ("methods advertise no passkey" and "the endpoint answered 501"), and case 6
    // only ever reaches the first: deleting the 501 branch entirely left the suite
    // green. Found by mutating the probe, which is why this case exists.
    const idp = await startIdp(REALM);
    await withFixtures([idp], async () => {
      const bff = await startBff({
        backIssuer: idp.issuer,
        issuerStatus: ISSUER_STATUS_RESOLVED,
        frontOrigin: idp.baseUrl,
        realm: REALM,
        passkeyEndpointEnabled: false,
      });
      await withFixtures([bff], async () => {
        const probe = await probeAuthCodeAgreement(request, portalFor(bff.baseUrl));
        expect(probe.kind, 'a 501 front channel is UNCHECKED, not verified').toBe('skip');
        if (probe.kind === 'skip') expect(probe.reason).toContain('501');
      });
    });
  });
});

/**
 * Kefi custom-domain E2E (#5 subdomain CNAME + #240 apex A-record).
 *
 * Proves the tenant-owner custom-domain API contract end-to-end against a real
 * verified canary tenant:
 *
 *   1. signup → IMAP verify → 4-step wizard → a verified canary tenant.
 *   2. GET            → None (no domain yet).
 *   3. PUT bare TLD   → 400 (single-label junk still rejected).
 *   4. PUT subdomain  → 200, status PendingDns, customDomain normalized (lower),
 *                       recordType 'CNAME', cnameTarget == {slug}.kefi.dloizides.com,
 *                       apexTarget null.
 *   5. GET            → reflects PendingDns + the CNAME instruction.
 *   6. PUT apex       → 200, status PendingDns, recordType 'A', cnameTarget null,
 *                       apexTarget == the configured cluster IP (#240). The apex A
 *                       instruction is A {domain} -> {clusterIp}.
 *   7. POST verify on a NON-resolving apex → 200, status Failed + lastError
 *      (real DNS can't resolve it; verification is honest, no test bypass).
 *   8. DELETE         → 200, status None, customDomain null (+ deprovision).
 *
 * The verify→Active path provisions a real Ingress + Traefik middleware and needs
 * a host that actually resolves to the cluster, so it is NOT asserted here unless
 * KEFI_CD_TEST_DOMAIN is set to a wildcard-covered host (the deploy-time real
 * smoke wires that in). The Active path is otherwise covered by the backend unit
 * tests. Cross-tenant 409 dup is covered by unit tests (needs two tenants).
 *
 * Mocked-DNS note: "mocked DNS" here means we drive verification deterministically
 * by choosing the domain — a `.invalid` host that can never resolve gives a
 * deterministic Failed; a wildcard-covered host (via KEFI_CD_TEST_DOMAIN) gives a
 * deterministic Active. There is NO production verification bypass. The apex verify
 * path is identical to the subdomain one (resolves-to-cluster), so it is exercised
 * here only for the honest-Failed case; the apex→Active real smoke is the optional
 * KEFI_CD_TEST_DOMAIN block (set it to an apex host to cover that on deploy).
 *
 * API-driven beyond the shared signup→wizard rig. Runs on staging + prod via
 * E2E_TARGET; local is skipped (no kefi dev stack).
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiCustomDomainClient } from '../../helpers/kefi/kefiCustomDomainClient.js';
import { forceOnboardingPlan } from '../../helpers/kefi/kefiOnboardingApi.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_DAYS_AHEAD = 60;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const CNAME_SUFFIX = '.kefi.dloizides.com';
/** Optional: a wildcard-covered host that DOES resolve to the cluster (deploy-time real smoke). */
const REAL_SMOKE_DOMAIN = process.env.KEFI_CD_TEST_DOMAIN?.trim();

function dateAhead(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

test.describe('Kefi #5 — custom domains', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi custom-domain E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('sets a subdomain (CNAME) + an apex domain (A record), verifies + clears', async ({ page }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const cd = new KefiCustomDomainClient(admin);
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    test.info().attach('canaryId', { body: ctx.canaryId, contentType: 'text/plain' });

    try {
      // ── 1. signup → verify → wizard → a verified tenant ──
      const marketing = new KefiMarketingPage(page);
      await marketing.goto();
      await marketing.signupAndExpectSuccess({
        email: ctx.email,
        password: ctx.password,
        tenantName: ctx.tenantName,
      });
      await new KefiSignupSuccessPage(page).expectLoaded();

      const mailbox = new KefiMailbox(loadKefiMailboxConfig(), {
        timeoutMs: 60_000,
        pollIntervalMs: 2_000,
      });
      const captured = await mailbox.waitForMessageTo(ctx.email);
      const verifyUrl = extractVerifyUrl(captured);
      expect(verifyUrl, `verify URL from ${captured.subject}`).not.toBeNull();
      await page.goto(verifyUrl!);

      const wizard = new KefiOnboardingWizardPage(page);
      await wizard.expectLoaded();
      await wizard.fillFastPath({
        canaryPrefix: ctx.slugPrefix,
        eventDateIso: dateAhead(EVENT_DAYS_AHEAD),
      });
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: ctx.email,
        password: ctx.password,
      });
      await forceOnboardingPlan({ apiUrl: getKefiUrls().apiUrl, bearer: ownerBearer, code: 'pro' });
      await wizard.finishFromReview();

      const owner = { ownerEmail: ctx.email, ownerPassword: ctx.password };

      // ── 2. GET → None ──
      const initial = await cd.get(owner);
      expect(initial.status, 'GET custom-domain status').toBe(HTTP_OK);
      expect(initial.body.status, 'no custom domain initially').toBe('None');
      expect(initial.body.customDomain, 'no domain initially').toBeNull();

      // ── 3. PUT bare TLD → 400 (single-label junk still rejected) ──
      const bareTld = await cd.set(owner, 'com');
      expect(bareTld.status, 'bare TLD rejected').toBe(HTTP_BAD_REQUEST);

      // ── 4. PUT valid subdomain → PendingDns + CNAME instructions ──
      const desired = `events-${ctx.canaryId}.example.com`;
      const set = await cd.set(owner, ` Events-${ctx.canaryId}.Example.COM `);
      expect(set.status, 'set subdomain → 200').toBe(HTTP_OK);
      expect(set.body.status, 'set → PendingDns').toBe('PendingDns');
      expect(set.body.customDomain, 'domain normalized to lower-case + trimmed').toBe(desired);
      expect(set.body.recordType, 'subdomain uses a CNAME record').toBe('CNAME');
      expect(set.body.cnameTarget, 'cnameTarget is the tenant host').not.toBeNull();
      expect(set.body.cnameTarget!.endsWith(CNAME_SUFFIX), 'cnameTarget under kefi zone').toBe(true);
      expect(set.body.apexTarget, 'subdomain carries no apex target').toBeNull();

      // ── 5. GET reflects PendingDns ──
      const afterSet = await cd.get(owner);
      expect(afterSet.body.status, 'GET reflects PendingDns').toBe('PendingDns');
      expect(afterSet.body.customDomain, 'GET reflects the domain').toBe(desired);
      expect(afterSet.body.recordType, 'GET reflects the CNAME record type').toBe('CNAME');

      // ── 6. PUT apex domain → PendingDns + A-record instruction (#240) ──
      const apexDomain = `cd-apex-${ctx.canaryId}.com`;
      const apex = await cd.set(owner, ` CD-Apex-${ctx.canaryId}.COM `);
      expect(apex.status, 'set apex → 200 (apex now supported)').toBe(HTTP_OK);
      expect(apex.body.status, 'apex set → PendingDns').toBe('PendingDns');
      expect(apex.body.customDomain, 'apex normalized to lower-case + trimmed').toBe(apexDomain);
      expect(apex.body.recordType, 'apex uses an A record').toBe('A');
      expect(apex.body.cnameTarget, 'apex carries no CNAME target').toBeNull();
      // apexTarget is the configured cluster IP. It is null only if the cluster has
      // not set CustomDomains:ApexTargetIp yet — assert it is present + non-empty.
      expect(apex.body.apexTarget, 'apex carries the cluster A-record IP').toBeTruthy();

      // ── 7. verify the (NON-resolving) apex domain → Failed (honest DNS check) ──
      // The apex above can never resolve to the cluster from CI, so verify must
      // honestly fail — same resolves-to-cluster path as a subdomain, no bypass.
      const verifyFail = await cd.verify(owner);
      expect(verifyFail.status, 'verify returns 200 even on failure').toBe(HTTP_OK);
      expect(verifyFail.body.status, 'verify of non-resolving apex → Failed').toBe('Failed');
      expect(verifyFail.body.lastError, 'failure carries a reason').toBeTruthy();

      // ── 7b. Optional real-smoke: a host (subdomain OR apex) that resolves to the
      //         cluster verifies → Active. Set KEFI_CD_TEST_DOMAIN to an apex host to
      //         cover the apex→Active path against real DNS at deploy time (#240). ──
      if (REAL_SMOKE_DOMAIN) {
        const setReal = await cd.set(owner, REAL_SMOKE_DOMAIN);
        expect(setReal.status, 'set real resolving host → 200').toBe(HTTP_OK);
        const verifyOk = await cd.verify(owner);
        expect(verifyOk.status, 'verify real host → 200').toBe(HTTP_OK);
        expect(verifyOk.body.status, `verify ${REAL_SMOKE_DOMAIN} → Active`).toBe('Active');
        expect(verifyOk.body.verifiedAt, 'Active carries verifiedAt').toBeTruthy();
      }

      // ── 8. DELETE → None ──
      const cleared = await cd.clear(owner);
      expect(cleared.status, 'clear → 200').toBe(HTTP_OK);
      expect(cleared.body.status, 'clear → None').toBe('None');
      expect(cleared.body.customDomain, 'clear removes the domain').toBeNull();

      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

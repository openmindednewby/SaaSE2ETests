/**
 * Kefi per-event publish E2E (#4).
 *
 * Proves a single tenant can publish MULTIPLE events, each at its own public
 * URL (`/t/{slug}/{eventSlug}`), with an editable per-event slug, while the
 * legacy single-event surfaces stay backward-compatible.
 *
 *   1. signup → IMAP verify → 4-step wizard → a verified canary tenant whose
 *      auto-created first event already has a slug + landing config (the
 *      onboarding handler seeds both). This is EVENT 1 — given the LATER date so
 *      it is the tenant's "latest" event (latest = ORDER BY date desc, id desc).
 *   2. Create a SECOND event via POST /admin/events with a distinct name + an
 *      EARLIER date; assert its auto slug is non-empty + kebab.
 *   3. Give event 2 a per-event landing config (PUT .../landing-config) so it is
 *      "published" (event 1 was already published by the wizard).
 *   4. Public (anonymous):
 *      - GET /t/{slug}/events            → contains BOTH event slugs.
 *      - GET /t/{slug}/{event1Slug}      → event.name == event1 (per-event scope).
 *      - GET /t/{slug}/{event2Slug}      → event.name == event2.
 *      - GET /t/{slug}/{nonexistent}     → 404.
 *      - GET /t/{slug}                   → still the LATEST event (== event1).
 *   5. Editable slug: PUT .../{event2}/slug → 200 + new slug; the NEW slug
 *      resolves, the OLD slug 404s; a DUPLICATE (event1's slug) → 400.
 *   6. Register books the named event:
 *      - seed a pass on the LATEST event (event 1) via the #185 canary endpoint.
 *      - register WITHOUT eventSlug → books the latest (event 1).
 *      - register WITH eventSlug = event2 (no pass) → 400 "not a valid pass for
 *        this event": proves the eventSlug ROUTES the booking to event 2 (had it
 *        been ignored, the FULL pass would have matched event 1 → 201). See the
 *        "WHICH event a registration booked" note at the bottom.
 *      - register WITH eventSlug = event1 → books event 1 (explicit-slug booking).
 *   7. cleanup via cleanupKefiCanary.
 *
 * API-driven (no SPA UI beyond the shared signup→wizard rig). Runs on
 * staging + prod via E2E_TARGET; local is skipped (no kefi dev stack).
 */

import { test, expect } from '@playwright/test';

import { KefiMarketingPage } from '../../pages/kefi/KefiMarketingPage.js';
import { KefiSignupSuccessPage } from '../../pages/kefi/KefiSignupSuccessPage.js';
import { KefiOnboardingWizardPage } from '../../pages/kefi/KefiOnboardingWizardPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiEventClient, type MyEventSummary } from '../../helpers/kefi/kefiEventClient.js';
import { KefiLifecycleClient } from '../../helpers/kefi/kefiLifecycleClient.js';
import { forceOnboardingPlan } from '../../helpers/kefi/kefiOnboardingApi.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { cleanupKefiCanary } from '../../helpers/kefi/kefiTeardown.js';
import { newCanaryContext } from '../../helpers/kefi/kefiCanaryIds.js';
import {
  KefiMailbox,
  extractVerifyUrl,
  loadKefiMailboxConfig,
} from '../../helpers/kefi/kefiMailboxClient.js';
import { buildKucyShapedConfig } from '../../helpers/kefi/kefiKucyShapedConfig.js';
import { isRemoteTarget } from '../../helpers/target.js';

// Serial — shares the single bot mailbox (signup/verify IMAP) with the other
// kefi canary specs.
test.describe.configure({ mode: 'serial' });

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Event 1 (wizard) is the LATER date → the tenant's "latest" event. */
const EVENT1_DAYS_AHEAD = 120;
/** Event 2 (created) is the EARLIER date → NOT the latest. */
const EVENT2_DAYS_AHEAD = 30;
const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 25 } as const;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateAhead(days: number): string {
  return toIsoDate(new Date(Date.now() + days * MS_PER_DAY));
}

test.describe('Kefi #4 — per-event publish', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi per-event publish E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('publishes two events at distinct slugs, edits a slug, books the named event', async ({ page }) => {
    const ctx = newCanaryContext();
    const admin = new KefiAdminClient();
    const events = new KefiEventClient(admin);
    const lifecycle = new KefiLifecycleClient(admin);
    test.info().annotations.push({ type: 'canaryId', description: ctx.canaryId });
    test.info().attach('canaryId', { body: ctx.canaryId, contentType: 'text/plain' });

    try {
      // ── 1. signup → verify → wizard → a verified tenant with event 1 ──
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
        eventDateIso: dateAhead(EVENT1_DAYS_AHEAD),
      });
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: ctx.email,
        password: ctx.password,
      });
      await forceOnboardingPlan({ apiUrl: getKefiUrls().apiUrl, bearer: ownerBearer, code: 'pro' });
      await wizard.finishFromReview();

      const owner = { ownerEmail: ctx.email, ownerPassword: ctx.password };

      // The wizard auto-created event 1 with a slug + landing config. Read it
      // back so we have its externalId + slug (the wizard never returns them).
      const afterWizard = await events.listMyEvents(owner);
      expect(afterWizard.events.length, 'one event after wizard').toBe(1);
      const tenantSlug = afterWizard.tenantSlug;
      const event1 = afterWizard.events[0];
      expect(event1.slug, 'wizard event 1 has a slug').toBeTruthy();

      // ── 2. Create event 2 (distinct name, EARLIER date) ──────────────
      const event2Name = `${ctx.slugPrefix}Canary Second Gala`;
      const created = await events.createMyEvent({
        ...owner,
        name: event2Name,
        dateIso: dateAhead(EVENT2_DAYS_AHEAD),
      });
      expect(created.name, 'event 2 name').toBe(event2Name);
      expect(created.slug, 'event 2 auto slug present').toBeTruthy();
      expect(created.slug!, 'event 2 slug is kebab').toMatch(KEBAB_SLUG);
      const event2ExternalId = created.externalId;
      const event2Slug = created.slug!;
      expect(event2Slug, 'event 2 slug differs from event 1').not.toBe(event1.slug);

      // ── 3. Publish event 2 (per-event landing config) ────────────────
      // Event 1 is already published (the wizard wrote its landing config);
      // event 2 needs one to appear in the public published-events list.
      await events.putEventLandingConfig({
        ...owner,
        externalId: event2ExternalId,
        dto: buildKucyShapedConfig(ctx.slugPrefix),
      });

      // ── 4. Public assertions (anonymous) ─────────────────────────────
      const list = await events.getPublicEvents(tenantSlug);
      expect(list.status, 'GET /t/{slug}/events status').toBe(HTTP_OK);
      const listedSlugs = list.body.events.map((e) => e.slug);
      expect(listedSlugs, 'events list contains event 1 slug').toContain(event1.slug);
      expect(listedSlugs, 'events list contains event 2 slug').toContain(event2Slug);

      const ev1Landing = await events.getPublicEventLanding(tenantSlug, event1.slug!);
      expect(ev1Landing.status, 'GET /t/{slug}/{event1Slug} status').toBe(HTTP_OK);
      expect(ev1Landing.body.event?.name, 'event 1 per-event landing name').toBe(event1.name);

      const ev2Landing = await events.getPublicEventLanding(tenantSlug, event2Slug);
      expect(ev2Landing.status, 'GET /t/{slug}/{event2Slug} status').toBe(HTTP_OK);
      expect(ev2Landing.body.event?.name, 'event 2 per-event landing name').toBe(event2Name);

      const missing = await events.getPublicEventLanding(tenantSlug, `${ctx.slugPrefix}does-not-exist`);
      expect(missing.status, 'unknown event slug 404s').toBe(HTTP_NOT_FOUND);

      // Backward-compat: /t/{slug} still returns the LATEST event (== event 1).
      const latest = await events.getPublicTenantLanding(tenantSlug);
      expect(latest.status, 'GET /t/{slug} status').toBe(HTTP_OK);
      expect(latest.body.event?.name, '/t/{slug} returns the latest event (event 1)').toBe(event1.name);

      // ── 5. Editable slug on event 2 ──────────────────────────────────
      const renamed = `${ctx.slugPrefix}renamed-gala`;
      const renameResult = await events.updateMyEventSlug({
        ...owner,
        externalId: event2ExternalId,
        slug: renamed,
      });
      expect(renameResult.status, 'rename slug status').toBe(HTTP_OK);
      const renamedSlug = (renameResult.body as MyEventSummary).slug;
      expect(renamedSlug, 'renamed slug echoed').toBe(renamed);

      const viaNew = await events.getPublicEventLanding(tenantSlug, renamed);
      expect(viaNew.status, 'new slug resolves').toBe(HTTP_OK);
      expect(viaNew.body.event?.name, 'new slug → event 2').toBe(event2Name);

      const viaOld = await events.getPublicEventLanding(tenantSlug, event2Slug);
      expect(viaOld.status, 'old slug 404s after rename').toBe(HTTP_NOT_FOUND);

      // Duplicate slug (event 1's slug) → 400.
      const dup = await events.updateMyEventSlug({
        ...owner,
        externalId: event2ExternalId,
        slug: event1.slug!,
      });
      expect(dup.status, 'duplicate slug rejected').toBe(HTTP_BAD_REQUEST);

      // ── 6. Register books the named event ────────────────────────────
      // Seed a pass on the LATEST event (event 1) — the #185 canary endpoint
      // ensures a pass on GetCurrentEvent (latest by date), which is event 1.
      const seeded = await lifecycle.seedCanaryEvent({
        canaryId: ctx.canaryId,
        eventDateOffsetDays: EVENT1_DAYS_AHEAD,
        status: 'Published',
        passCode: PASS.code,
        passLabel: PASS.label,
        priceEur: PASS.priceEur,
      });
      expect(seeded.found, 'canary tenant found for seeding').toBe(true);
      // The seeded event must be event 1 (the latest) — that's where the pass landed.
      expect(seeded.eventExternalId, 'seed targeted event 1 (the latest)').toBe(event1.externalId);

      // Register WITHOUT eventSlug → books the latest (event 1).
      const regLatest = await lifecycle.registerAttendeeFull({
        slug: tenantSlug,
        name: 'Latest',
        surname: 'Canary',
        phone: '+35799000300',
        email: ctx.email.replace('@', '-latest@'),
        passCode: PASS.code,
        consentGiven: true,
      });
      expect(regLatest.status, 'register without eventSlug → 201').toBe(HTTP_CREATED);
      expect(regLatest.eventName, 'no eventSlug books the latest (event 1)').toBe(event1.name);

      // Register WITH eventSlug = event 2 (which has NO pass) → 400. This proves
      // the eventSlug routed the booking to event 2: had it been ignored the FULL
      // pass would have matched the latest (event 1) and returned 201.
      const regEvent2 = await lifecycle.registerAttendeeFull({
        slug: tenantSlug,
        name: 'Routed',
        surname: 'Canary',
        phone: '+35799000301',
        email: ctx.email.replace('@', '-ev2@'),
        passCode: PASS.code,
        consentGiven: true,
        eventSlug: renamed,
      });
      expect(regEvent2.status, 'register with event 2 slug (no pass) → 400').toBe(HTTP_BAD_REQUEST);

      // Register WITH eventSlug = event 1 (explicit) → books event 1.
      const regEvent1 = await lifecycle.registerAttendeeFull({
        slug: tenantSlug,
        name: 'Explicit',
        surname: 'Canary',
        phone: '+35799000302',
        email: ctx.email.replace('@', '-ev1@'),
        passCode: PASS.code,
        consentGiven: true,
        eventSlug: event1.slug!,
      });
      expect(regEvent1.status, 'register with event 1 slug → 201').toBe(HTTP_CREATED);
      expect(regEvent1.eventName, 'explicit event 1 slug books event 1').toBe(event1.name);

      await mailbox.expungeMessages([captured.uid]).catch(() => undefined);
    } finally {
      await cleanupKefiCanary(ctx.canaryId, { adminClient: admin });
    }
  });
});

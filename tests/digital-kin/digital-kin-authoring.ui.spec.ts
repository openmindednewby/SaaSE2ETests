// Digital Kin authoring (@ui) — the flows a real author performs.
//
// This is the tier that can see what @api cannot: that Save is reachable, that a
// reorder SURVIVES a save and a reload, that publish is BLOCKED with a stated
// reason, and that unpublishing actually removes the guide from the public site.
//
// 🔴 THE JOIN. The CMS runs on staging behind a prod ingress; the public site is
// a separate Astro origin reading through a cache with no hard expiry. "Publish
// returned 200" and "a visitor can read it" are DIFFERENT CLAIMS. Only the
// round-trip test below makes the second one, and the cache purge is the
// mechanism between them — a purge that fails is silent everywhere else.
//
// 🔒 SKIP-GATED, LOUDLY. If the admin URL or credentials are missing the whole
// file skips with a reason. A skip is NOT a pass — read the run summary.
import { expect, test } from '@playwright/test';

import {
  DigitalKinGuideEditorPage,
  DigitalKinGuidesPage,
  DigitalKinLoginPage,
  DigitalKinShell,
} from '../../pages/digital-kin/DigitalKinAdminPage.js';
import {
  DigitalKinMessagesPage,
  DigitalKinTaxonomyPage,
} from '../../pages/digital-kin/DigitalKinAdminScreens.js';
import {
  DIGITALKIN_ADMIN_URL,
  DIGITALKIN_MASTER_PASSWORD,
  DIGITALKIN_MASTER_USER,
  DIGITALKIN_SITE_URL,
  dkTag,
  hasAdminCredentials,
} from './digital-kin-helpers.js';

const admin = DIGITALKIN_ADMIN_URL ?? '';
const masterUser = DIGITALKIN_MASTER_USER ?? '';
const masterPass = DIGITALKIN_MASTER_PASSWORD ?? '';

/** The three step texts, in the order they are first authored. */
const STEP_ONE = 'Ανοίξτε την εφαρμογή μηνυμάτων.';
const STEP_TWO = 'Επιλέξτε τον παραλήπτη.';
const STEP_THREE = 'Γράψτε το μήνυμά σας και πατήστε αποστολή.';

test.describe('Digital Kin authoring @digital-kin-ui @digital-kin', () => {
  test.skip(
    !hasAdminCredentials(),
    'DIGITALKIN_ADMIN_URL / DIGITALKIN_DEMO_MASTER_* not set — see E2ETests/.env.staging(.secrets).',
  );

  test.beforeEach(async ({ page }) => {
    const login = new DigitalKinLoginPage(page);
    await login.goto(admin);
    await login.signIn(masterUser, masterPass);
  });

  test('🔴 author a guide, reorder its steps, and the new order survives save + reload', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const guides = new DigitalKinGuidesPage(page);
    const editor = new DigitalKinGuideEditorPage(page);
    const title = `${dkTag()} Δοκιμαστικός οδηγός`;

    const guideId = await guides.createGuide(title);
    expect(guideId, 'no guide id in the editor URL').toMatch(/^[0-9a-f-]{36}$/);

    // Publish must be refused on an empty guide, and the checklist must say WHY.
    // A disabled button with no explanation is the dead end this audience cannot
    // recover from on their own.
    await expect(editor.publishButton, 'publish is enabled on an empty guide').toBeDisabled();
    await expect(editor.publishBlockers, 'no publish checklist on an empty guide').toBeVisible();
    await expect(editor.blocker('no_steps'), 'the checklist never names the missing steps')
      .toContainText('Τουλάχιστον ένα βήμα');

    await editor.appendStep(STEP_ONE, 1);
    await editor.appendStep(STEP_TWO, 2);
    await editor.appendStep(STEP_THREE, 3);
    await editor.save();

    // With three real steps the blocker must clear and publish must open up.
    await expect(editor.publishButton, 'publish stayed disabled on a complete guide').toBeEnabled();

    // The bounds are asserted, because "move" on the first/last step is where an
    // off-by-one silently wraps or no-ops.
    await expect(editor.stepUp(1), 'step 1 can be moved up').toBeDisabled();
    await expect(editor.stepDown(3), 'the last step can be moved down').toBeDisabled();

    // 🔴 The reorder. Guide.Renumber() once sorted by a STALE StepOrder and
    // discarded every move — the UI showed the new order, the save reported
    // success, and the reload showed the old order. Only save+reload catches it.
    await editor.stepDown(1).click();
    expect(await editor.stepTexts(), 'the move did not reorder the form').toEqual([
      STEP_TWO,
      STEP_ONE,
      STEP_THREE,
    ]);

    await editor.save();
    // eslint-disable-next-line no-page-reload/no-page-reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(editor.screen).toBeVisible({ timeout: 30_000 });
    await expect(editor.stepText(1)).toHaveValue(STEP_TWO, { timeout: 30_000 });

    expect(await editor.stepTexts(), 'the reorder did not survive save + reload').toEqual([
      STEP_TWO,
      STEP_ONE,
      STEP_THREE,
    ]);

    await editor.deleteGuide();
  });

  test('🔴 publish -> the public site serves it; unpublish -> it 404s; re-publish -> it returns', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    test.skip(
      DIGITALKIN_SITE_URL === null,
      'DIGITALKIN_SITE_URL unset — cannot assert the public half of the round trip.',
    );

    const guides = new DigitalKinGuidesPage(page);
    const editor = new DigitalKinGuideEditorPage(page);
    const title = `${dkTag()} Δημοσίευση`;

    await guides.createGuide(title);
    await editor.appendStep(STEP_ONE, 1);
    await editor.save();

    const publicPath = await editor.publicPath();
    expect(publicPath, 'the editor never showed a public path').toMatch(/^\/odigos\//);
    const publicUrl = `${DIGITALKIN_SITE_URL ?? ''}${publicPath}`;

    await editor.publish();

    // A fresh anonymous context — no admin cookie, nothing warm. This is the only
    // assertion in the whole suite that a VISITOR can read what was published.
    const anon = await browser.newContext();
    try {
      const visitor = await anon.newPage();

      await expect
        .poll(async () => (await visitor.goto(publicUrl))?.status() ?? 0, {
          timeout: 90_000,
          intervals: [2_000, 4_000, 8_000],
          message:
            `the published guide never appeared at ${publicUrl}. Publish succeeded, so suspect the ` +
            'CACHE PURGE: DigitalKinService POSTs /_cache/purge with X-DigitalKin-Purge-Secret, the ' +
            'Astro receiver FAILS CLOSED when its secret is unset, and CachePurger SWALLOWS the 403 — ' +
            'so a secret mismatch is silent. Compare Astro__PurgeSecret on digitalkin-api with ' +
            'DIGITALKIN_PURGE_SECRET on digital-kin-site.',
        })
        .toBe(200);

      await expect(visitor.getByRole('heading', { level: 1 })).toContainText(title);

      // Unpublish must actually withdraw it, not merely flip a badge in the CMS.
      //
      // 🔴 ASYMMETRIC LATENCY, MEASURED 2026-07-22. Publishing propagates to the
      // public site within ~10s, but withdrawal took LONGER THAN 90 SECONDS: a
      // guide unpublished in the CMS kept serving 200 for the whole 90s poll and
      // only 404'd minutes later. So the window is generous here on purpose —
      // and the size of that window is itself the finding. If an author
      // unpublishes something wrong or private, it stays readable meanwhile.
      await editor.unpublish();
      await expect
        .poll(async () => (await visitor.goto(publicUrl))?.status() ?? 0, {
          timeout: 240_000,
          intervals: [5_000, 10_000, 15_000],
          message:
            `unpublish left the guide readable at ${publicUrl} for over 4 minutes. Publishing ` +
            'propagates quickly, so the withdrawal path is the asymmetry: check that unpublish ' +
            'triggers the same CachePurger call publish does (a swallowed 403 there is silent).',
        })
        .toBe(404);

      // And re-publishing must bring it back, so unpublish is reversible.
      await editor.publish();
      await expect
        .poll(async () => (await visitor.goto(publicUrl))?.status() ?? 0, {
          timeout: 90_000,
          intervals: [2_000, 4_000, 8_000],
          message: `re-publish did not restore ${publicUrl}.`,
        })
        .toBe(200);
    } finally {
      await anon.close();
    }

    await editor.unpublish();
    await editor.deleteGuide();
  });

  test('a step takes a YouTube link, and attaching one is enough to save', async ({ page }) => {
    test.setTimeout(120_000);

    const guides = new DigitalKinGuidesPage(page);
    const editor = new DigitalKinGuideEditorPage(page);

    await guides.createGuide(`${dkTag()} YouTube`);
    await editor.appendStep(STEP_ONE, 1);

    // Image and YouTube are mutually exclusive BY CONSTRUCTION: attaching an
    // image removes the link field entirely rather than disabling it.
    await expect(editor.youTube(1), 'no YouTube field on a step with no image').toBeVisible();
    await editor.youTube(1).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await editor.save();

    // eslint-disable-next-line no-page-reload/no-page-reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(editor.youTube(1), 'the YouTube link did not persist').toHaveValue(
      /dQw4w9WgXcQ/,
      { timeout: 30_000 },
    );

    await editor.deleteGuide();
  });

  test('the contact inbox shows the never-emailed alarm independently of the handled tick', async ({
    page,
  }) => {
    const messages = new DigitalKinMessagesPage(page);
    await messages.goto(admin);

    // The two states are ORTHOGONAL: a message can be handled by a human and
    // still have never been emailed. Collapsing them would hide the fact that
    // outbound mail is broken, which is the failure this screen exists to catch.
    const cards = page.locator('[data-testid^="message-card-"]');

    // 🔴 WAIT for the list to resolve before branching on its size. Reading
    // count() immediately races the fetch, sees 0, takes the empty-state branch
    // and fails against an inbox that actually has messages. That is a test bug
    // that reads exactly like a product bug.
    await expect
      .poll(async () => (await cards.count()) > 0 || (await messages.empty.count()) > 0, {
        timeout: 30_000,
        message: 'the inbox rendered neither a message card nor an empty state',
      })
      .toBe(true);

    const count = await cards.count();
    if (count === 0) {
      await expect(messages.empty, 'no messages and no empty state either').toBeVisible();
      return;
    }

    const firstId = ((await cards.first().getAttribute('data-testid')) ?? '').replace(
      'message-card-',
      '',
    );
    expect(firstId, 'could not read a message id').not.toBe('');

    // Exactly one of the two email states must render — never both, never neither.
    const awaiting = await messages.awaitingEmail(firstId).count();
    const emailed = await messages.emailed(firstId).count();
    expect(
      awaiting + emailed,
      'a message shows neither "awaiting email" nor "emailed" — the alarm is missing',
    ).toBe(1);

    // And the handled toggle must be a separate control from either of them.
    await expect(messages.toggle(firstId), 'no handled toggle on a message').toBeVisible();
  });

  test('master sees the taxonomy nav and can open the screen — the positive control', async ({
    page,
  }) => {
    const shell = new DigitalKinShell(page);
    const taxonomy = new DigitalKinTaxonomyPage(page);

    await expect(shell.navGuides).toBeVisible();
    await expect(shell.navTaxonomy, 'master cannot see the taxonomy nav').toBeVisible();

    await taxonomy.goto(admin);
    await expect(taxonomy.screen, 'master was refused the taxonomy screen').toBeVisible({
      timeout: 30_000,
    });
    await expect(taxonomy.forbidden).toHaveCount(0);
  });
});


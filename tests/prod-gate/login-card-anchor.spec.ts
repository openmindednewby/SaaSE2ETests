/**
 * FLEET login-card ANCHORING guard (auth-web 1.14.0) — the card may grow, but the input fields
 * must not MOVE.
 *
 * ── The defect ────────────────────────────────────────────────────────────────────────────────
 *
 * The login card was vertically CENTRED. Centring is stable only while the content is a fixed
 * height — and this card's height is not fixed. It grows whenever:
 *
 *   * a validation error line appears under a field;
 *   * the passkey button arrives after the `/bff/config` fetch resolves;
 *   * the OTP tab swaps in a differently-sized form;
 *   * the demo disclosure expands.
 *
 * Every one of those re-centres the card, and because a centred box absorbs half its own growth
 * upward, the fields the user is actively typing into SLIDE UP under the cursor. It was measured
 * at 72px on a real portal — enough to move the password field out from under a click that was
 * already on its way down. 1.14.0 anchors the card to the top, so growth extends downward only.
 *
 * ── Why this asserts NON-MOVEMENT and not a pixel position ────────────────────────────────────
 *
 * The absolute y of the username field is a function of the viewport, the header, the theme's
 * spacing tokens and the portal's own branding — it legitimately differs per portal and changes
 * with any design-token edit. Asserting it would be a test that fails for every reason except the
 * one it is named after. The INVARIANT is the delta: whatever y the field starts at, growing the
 * card must not change it.
 *
 * ── 🔴 The vacuity guard that makes this test mean anything ───────────────────────────────────
 *
 * "The field did not move" is trivially true if the card never grew. A test that submits an empty
 * form, fails to trigger any validation, and then reports that nothing moved would pass with equal
 * confidence on the BROKEN build — it would simply never have exercised the defect. This suite has
 * a documented history of exactly that shape (the i18n scan that read an empty DOM and reported
 * fleet-wide green).
 *
 * So the growth itself is asserted FIRST, as a hard precondition: the card must be measurably
 * taller after the interaction than before. Only then is the non-movement assertion meaningful,
 * and if the growth never happens the test FAILS and says the trigger stopped working rather than
 * quietly passing.
 */
import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

interface Portal {
  readonly label: string;
  readonly baseUrl: string;
  /** zygos namespaces its shared-kit testIDs; the others use the bare auth-web ones. */
  readonly testIdPrefix: string;
}

const PORTALS: readonly Portal[] = [
  { label: 'erevna-web', baseUrl: process.env.EREVNA_BASE_URL ?? '', testIdPrefix: '' },
  { label: 'katalogos-web', baseUrl: process.env.KATALOGOS_BASE_URL ?? '', testIdPrefix: '' },
  { label: 'zygos-web', baseUrl: process.env.ZYGOS_WEB_URL ?? '', testIdPrefix: 'zygos-' },
];

/** Sub-pixel layout tolerance. The defect was 72px, so this is nowhere near flake territory. */
const DRIFT_TOLERANCE_PX = 2;

/** The card must grow by at least this much for the anchoring assertion to have been exercised. */
const MIN_MEANINGFUL_GROWTH_PX = 8;

async function fieldTop(page: Page, testId: string): Promise<number> {
  const box = await page.locator(`[data-testid="${testId}"]`).first().boundingBox();
  expect(box, `could not measure "${testId}"`).not.toBeNull();
  return (box as { y: number }).y;
}

/** Total height of the rendered auth form, measured from the outermost growing container. */
async function formHeight(page: Page, usernameTestId: string): Promise<number> {
  return await page.evaluate((id) => {
    const input = document.querySelector(`[data-testid="${id}"]`);
    if (input === null) return 0;
    // Climb a few levels to the card-ish container; the exact node differs per portal, so take the
    // nearest ancestor that is materially taller than the input itself.
    let node: HTMLElement | null = input as HTMLElement;
    const inputHeight = node.getBoundingClientRect().height;
    while (node?.parentElement) {
      const height = node.parentElement.getBoundingClientRect().height;
      if (height > inputHeight * 3) return height;
      node = node.parentElement;
    }
    return node?.getBoundingClientRect().height ?? 0;
  }, usernameTestId);
}

for (const portal of PORTALS) {
  test(`prod-gate: ${portal.label} login card is TOP-ANCHORED — growth must not move the inputs`, async ({
    page,
  }) => {
    test.skip(
      portal.baseUrl.trim() === '',
      `${portal.label}: base URL not configured for this target — NO ANCHORING GUARD RAN for this portal.`,
    );

    const username = `${portal.testIdPrefix}auth-login-username`;
    const password = `${portal.testIdPrefix}auth-login-password`;
    const submit = `${portal.testIdPrefix}auth-login-submit`;

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${portal.baseUrl.replace(/\/+$/, '')}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Wait for the form to be interactive BEFORE the baseline. Measuring during hydration would
    // capture a mid-render position and the "drift" that follows would be hydration, not the
    // defect — a false positive that would read as a product regression.
    await expect(page.locator(`[data-testid="${username}"]`).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[data-testid="${submit}"]`).first()).toBeEnabled({ timeout: 30_000 });

    const heightBefore = await formHeight(page, username);
    const usernameTopBefore = await fieldTop(page, username);
    const passwordTopBefore = await fieldTop(page, password);

    // Grow the card the way a real user does: submit with empty credentials so the validation
    // lines appear beneath the fields. This is the cheapest of the four growth triggers listed in
    // the header and needs no credentials, so it runs on prod safely.
    await page.locator(`[data-testid="${submit}"]`).first().click();

    // Readiness is the growth itself — poll for it rather than sleeping through it.
    await expect
      .poll(async () => await formHeight(page, username), { timeout: 15_000 })
      .toBeGreaterThan(heightBefore + MIN_MEANINGFUL_GROWTH_PX - 1);

    const heightAfter = await formHeight(page, username);

    // 🔴 PRECONDITION, not a nicety. See the header: without proven growth, everything below
    // passes just as happily on the centred (broken) build.
    expect(
      heightAfter - heightBefore,
      `${portal.label}: the login card did NOT grow after submitting an empty form ` +
        `(${String(heightBefore)}px → ${String(heightAfter)}px). The anchoring assertion below would be ` +
        `VACUOUS — it would pass on the centred build too, because nothing ever re-centred. ` +
        `Find a growth trigger that still works (validation line, passkey button, OTP tab, demo ` +
        `disclosure) rather than deleting this check.`,
    ).toBeGreaterThanOrEqual(MIN_MEANINGFUL_GROWTH_PX);

    const usernameTopAfter = await fieldTop(page, username);
    const passwordTopAfter = await fieldTop(page, password);

    expect(
      Math.abs(usernameTopAfter - usernameTopBefore),
      `${portal.label}: the username field MOVED from y=${String(usernameTopBefore)} to ` +
        `y=${String(usernameTopAfter)} when the card grew by ${String(heightAfter - heightBefore)}px. ` +
        `A top-anchored card grows DOWNWARD only. Movement here means the card is still vertically ` +
        `centred (auth-web < 1.14.0 behaviour), so every validation error, the passkey button ` +
        `arriving, an OTP tab swap and the demo disclosure all drag the inputs out from under the user.`,
    ).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);

    expect(
      Math.abs(passwordTopAfter - passwordTopBefore),
      `${portal.label}: the password field MOVED from y=${String(passwordTopBefore)} to ` +
        `y=${String(passwordTopAfter)} when the card grew. Same defect as above; the password field ` +
        `is the one users are mid-click on when it slides.`,
    ).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);
  });
}

/**
 * Layout-sanity regression for P1-04 (Erevna login page was ungrouped).
 *
 * The bug: erevna's `login.tsx` rendered the method tabs, the shared `<LoginForm>`
 * card (which has `flex: 1`), and the passkey button as direct children of a
 * `justifyContent: 'center'` root. The growing form ate all vertical slack →
 * tabs pinned to the TOP edge, passkey stranded at the BOTTOM edge (space-between
 * look). The fix wraps them in one centered auto-height card `View`
 * (`testID="erevna-login-card"`).
 *
 * This asserts the pieces are GROUPED inside that card — not spread across the
 * viewport — tolerance-based (not pixel-perfect). No auth: it only inspects the
 * logged-out login screen, so it needs no creds and runs anywhere `login`
 * renders (prod via `EREVNA_BASE_URL`, or a local erevna-web dev server).
 *
 * Run under the `prod-gate` project: `E2E_TARGET=prod npm run test:prod-gate`.
 */
import { test, expect } from '@playwright/test';

const erevnaUrl = process.env.EREVNA_BASE_URL;

test('prod-gate: erevna login is a single grouped card, not spread', async ({ page }) => {
  test.skip(!erevnaUrl, 'EREVNA_BASE_URL not set for this target');

  await page.goto(`${erevnaUrl!.replace(/\/$/, '')}/login`, { waitUntil: 'domcontentloaded' });

  const card = page.getByTestId('erevna-login-card');
  await expect(card).toBeVisible({ timeout: 30_000 });

  const cardBox = await card.boundingBox();
  const viewport = page.viewportSize();
  expect(cardBox, 'card must have a bounding box').not.toBeNull();
  expect(viewport, 'viewport size must be known').not.toBeNull();

  // The card groups the auth controls, so it must NOT stretch to fill the whole
  // viewport height (the pre-fix spread pushed content from the top edge to the
  // bottom edge). Allow generous headroom — this only catches the full-bleed
  // regression, not normal card growth.
  expect(cardBox!.height).toBeLessThan(viewport!.height * 0.9);

  // The submit button must live INSIDE the card's vertical bounds (before the
  // fix the tabs/passkey escaped the intended grouping).
  const submit = page.locator('[data-testid="auth-login-submit"]');
  await expect(submit).toBeVisible();
  const submitBox = await submit.boundingBox();
  expect(submitBox).not.toBeNull();
  const cardTop = cardBox!.y;
  const cardBottom = cardBox!.y + cardBox!.height;
  expect(submitBox!.y).toBeGreaterThanOrEqual(cardTop - 2);
  expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(cardBottom + 2);
});

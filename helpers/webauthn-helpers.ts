/**
 * WebAuthn E2E helpers — the CDP virtual authenticator + the reactive
 * Keycloak-hosted-page driver used by every passkey spec (kefi, katalogos,
 * erevna, …). Extracted from the kefi passkey spec (Increment 2) on its second
 * use (Increment 3 rollout).
 *
 * The virtual authenticator (CTAP2 / internal / resident-key / UV /
 * auto-presence) stands in for TouchID / Windows Hello: it lives on the page's
 * browser TARGET, so it survives cross-origin navigations (app → Keycloak →
 * app) and cookie clearing — exactly like a real platform authenticator.
 *
 * driveKeycloakPages() doesn't hard-code one exact KC page sequence — the
 * realm's flow decides what appears. It reacts to whichever known element is on
 * screen (username/password re-auth form, "Try another way" link, auth-method
 * selector, explicit WebAuthn trigger buttons, the post-ceremony label form)
 * until the browser leaves the identity host or the budget runs out.
 */

import { type CDPSession, type Page } from '@playwright/test';

/** Budget for one full KC redirect dance (re-auth + ceremony + label + callback). */
const KC_DRIVE_TIMEOUT_MS = 90_000;
/** Poll interval while watching for the next KC page element to react to. */
const KC_DRIVE_POLL_MS = 1_000;

/**
 * Attaches a CDP virtual WebAuthn authenticator to the page's browser target.
 * Returns the CDP session so callers can detach / add credentials if needed.
 */
export async function attachVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

/** True while the page is on a Keycloak-hosted page (any *identity.* host). */
export function isOnKeycloak(page: Page): boolean {
  return page.url().includes('identity.');
}

/** Clicks the first visible locator among candidates; returns what it clicked or null. */
async function clickFirstVisible(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      await locator.click().catch(() => undefined);
      return selector;
    }
  }
  return null;
}

/**
 * Reacts to whichever Keycloak hosted page is currently showing, until the
 * browser navigates back to the app (leaves the identity host) or the budget
 * runs out. The virtual authenticator answers every navigator.credentials.*
 * call silently.
 */
export async function driveKeycloakPages(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  const deadline = Date.now() + KC_DRIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isOnKeycloak(page)) return;

    // 1. Username/password re-auth form.
    const passwordField = page.locator('#password');
    const usernameField = page.locator('#username');
    const loginSubmit = page.locator('#kc-login');
    if (
      (await passwordField.isVisible().catch(() => false)) &&
      (await loginSubmit.isVisible().catch(() => false))
    ) {
      if (await usernameField.isVisible().catch(() => false)) {
        await usernameField.fill(credentials.email).catch(() => undefined);
      }
      await passwordField.fill(credentials.password).catch(() => undefined);
      await loginSubmit.click().catch(() => undefined);
      // KC HOSTED pages (third-party markup, branching ceremony) have no stable
      // app testIDs to wait on; settling the network before re-polling is the
      // right tool here — unlike our own app, where actionable waits apply.
      // eslint-disable-next-line no-networkidle/no-networkidle
      await page.waitForLoadState('networkidle').catch(() => undefined);
      continue;
    }

    // 2. Whatever known interactive element is showing, in priority order:
    //    try-another-way → password option in the method selector → WebAuthn
    //    trigger buttons → label-form save.
    const clicked = await clickFirstVisible(page, [
      '#try-another-way',
      '.select-auth-box-parent:has-text("Password")',
      '#authenticateWebAuthnButton',
      'input#registerWebAuthn',
      '#registerWebAuthn',
      'input[type="submit"]#saveWebAuthnRegistration',
      'form#register input[type="submit"]',
    ]);
    if (clicked !== null) {
      // KC hosted-page transition — settle before re-polling (see note above).
      // eslint-disable-next-line no-networkidle/no-networkidle
      await page.waitForLoadState('networkidle').catch(() => undefined);
      continue;
    }

    // Nothing recognisable yet — the ceremony JS may be running; poll again.
    // Polling an external KC page with branching transitions: a bounded delay is
    // the correct pattern (there is no single app element to wait on here).
    // eslint-disable-next-line no-wait-for-timeout/no-wait-for-timeout
    await page.waitForTimeout(KC_DRIVE_POLL_MS);
  }

  throw new Error(
    `Keycloak page drive timed out after ${KC_DRIVE_TIMEOUT_MS}ms — still on ${page.url()}`,
  );
}

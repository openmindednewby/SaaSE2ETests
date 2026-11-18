import fs from 'fs';

import { expect, test } from '@playwright/test';

import { assertNotCustomerTenant } from '../../../helpers/kefi/kefiFixtureTenant.js';
import { getKefiUrls, tenantPathUrl } from '../../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../../helpers/target.js';
import { NAV_TIMEOUT_MS, signInFixtureOrganizer } from '../tours/kefi-tour-session.js';
import { probeDark } from './kefiDarkProbe.js';

import type { Page } from '@playwright/test';
import type { StorageState } from '../tours/kefi-tour-session.js';
import type { DarkProbe } from './kefiDarkProbe.js';

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
] as const;
const SHELL_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 15_000;
const ERROR_TEXT_MAX = 200;
const EVENT_HEADER = 'organizer-event-header';
const EDITOR_HEADER = 'landing-editor-header';
const OUT_DIR = process.env.KEFI_DARK_OUT_DIR ?? 'test-results/kefi-dark-sight';

interface Route {
  readonly name: string;
  readonly url: () => string;
  readonly signedIn: boolean;
  readonly ready: (page: Page) => Promise<void>;
}

const fixtureSlug = (): string => (process.env.KEFI_FIXTURE_TENANT_SLUG ?? '').trim();

async function shellReady(page: Page, testId: string): Promise<void> {
  await expect(page.getByTestId(testId), `${testId} mounted`).toBeVisible({ timeout: SHELL_TIMEOUT_MS });
  await expect(page.getByTestId('error-boundary-reload-button'), 'no app error boundary').toHaveCount(0);
}

async function publicReady(page: Page): Promise<void> {
  await expect(page.locator('body'), 'tenant page rendered text').toContainText(/\S/, { timeout: SHELL_TIMEOUT_MS });
}

const ROUTES: readonly Route[] = [
  { name: 'dashboard', url: () => `${getKefiUrls().webUrl}/organizer`, signedIn: true, ready: (page) => shellReady(page, EVENT_HEADER) },
  { name: 'editor', url: () => `${getKefiUrls().webUrl}/organizer/landing`, signedIn: true, ready: (page) => shellReady(page, EDITOR_HEADER) },
  { name: 'public', url: () => tenantPathUrl(fixtureSlug()), signedIn: false, ready: publicReady },
];

const results: Record<string, DarkProbe> = {};

test.describe('KEFI-DARK-1 kefi dark scheme sighting captures', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web surfaces');
  let state: StorageState;

  test.beforeAll(async ({ browser }) => {
    assertNotCustomerTenant(fixtureSlug());
    state = await signInFixtureOrganizer(browser);
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  test.afterAll(() => {
    fs.writeFileSync(`${OUT_DIR}/probe.json`, JSON.stringify({ utc: new Date().toISOString(), ...results }, null, 1));
  });

  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`KEFI-DARK-1 ${route.name} at ${viewport.width}x${viewport.height} in the dark scheme, is captured with a contrast probe`, async ({ browser }) => {
        const key = `${route.name}@${viewport.width}x${viewport.height}`;
        const context = await browser.newContext({ storageState: route.signedIn ? state : undefined, viewport, colorScheme: 'dark', ignoreHTTPSErrors: true });
        await context.addInitScript(() => localStorage.setItem('DARK_MODE_PREFERENCE', 'dark'));
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, ERROR_TEXT_MAX)); });
        page.on('pageerror', (err) => errors.push(`pageerror: ${err.message.slice(0, ERROR_TEXT_MAX)}`));
        await page.goto(route.url(), { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await route.ready(page);
        await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS }).catch(() => undefined);

        const probe = await probeDark(page, errors);

        results[key] = probe;
        await page.screenshot({ path: `${OUT_DIR}/${route.name}-dark-${viewport.width}x${viewport.height}.png`, fullPage: true });
        await context.close();
        expect(probe.scheme, `${key} browser reports prefers-color-scheme dark`).toBe(true);
        expect(probe.scrollW, `${key} has no horizontal scroll`).toBeLessThanOrEqual(probe.vw);
      });
    }
  }
});

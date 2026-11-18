import { expect } from '@playwright/test';

import { bffLogin, proofOrganizer } from '../../../helpers/kefi/kefiBrowserLogin.js';
import { getKefiUrls } from '../../../helpers/kefi/kefiUrls.js';

import type { Browser } from '@playwright/test';

type StorageState = Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;

const NAV_TIMEOUT_MS = 60_000;

export async function signInFixtureOrganizer(browser: Browser): Promise<StorageState> {
  const creds = proofOrganizer();
  expect(creds.username.length, 'KEFI_FIXTURE_ORGANIZER_* credentials are configured').toBeGreaterThan(0);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`${getKefiUrls().webUrl}/login`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await bffLogin(page, creds);
  const state = await context.storageState();
  await context.close();
  return state;
}

export { NAV_TIMEOUT_MS };
export type { StorageState };

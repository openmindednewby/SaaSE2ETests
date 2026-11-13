import { test, expect } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import { fixtureTenantAvailable, FIXTURE_TENANT_SKIP_REASON, getKefiFixtureTenant } from '../../helpers/kefi/kefiFixtureTenant.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';
import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';

const SHOT_DIR = 'qa-screenshots/kefi-soldout-landing';
const SUBPIXEL = 1;
const SHELL_TIMEOUT = 45_000;
const TEXT_SELECTOR = 'body *:not(.skip):not([id^="a11y-hint-"])';

test.describe('Kefi landing editor pass row without sold-out (sighting)', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web organizer surface');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  test('AC-SO3-8 landing Prices pass row, shows no sold-out checkbox', async ({ page }, testInfo) => {
    const tenant = getKefiFixtureTenant();
    const login = new KefiLoginPage(page);
    await login.goto();
    await login.signIn({ email: tenant.organizerEmail, password: tenant.organizerPassword });
    await page.goto(`${getKefiUrls().webUrl}/organizer/landing`);
    const section = page.getByTestId('landing-builder-section-prices');
    await expect(section, 'the Prices section row never rendered').toBeVisible({ timeout: SHELL_TIMEOUT });

    await section.click();

    const passes = page.getByTestId('landing-form-passes');
    const firstRow = page.getByTestId('landing-pass-0');
    await expect(passes, 'the landing passes editor never rendered').toBeVisible();
    await expect(firstRow, 'the e2e fixture landing has no pass row (not seeded here)').toBeVisible();
    await expect(passes.locator('[data-testid$="-soldout"]'), 'a pass row still carries a sold-out control').toHaveCount(0);
    await expect(passes.getByRole('checkbox', { name: /sold out/i }), 'a pass row still has a Sold out checkbox').toHaveCount(0);
    await expect(passes.getByText(/sold out/i), 'the passes editor still mentions Sold out').toHaveCount(0);
    await firstRow.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${SHOT_DIR}/${testInfo.project.name}-pass-row.png` });
    expect(overflow, `page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(SUBPIXEL);
    await expectTextFits(page, TEXT_SELECTOR);
  });
});

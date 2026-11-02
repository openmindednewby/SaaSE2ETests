import { devices, expect, test, type Locator, type Page } from '@playwright/test';

import { CONSENT_BANNER, DESKTOP, livePatternSlug, recordWrites } from './helpers/screens';

const { defaultBrowserType: _phoneBrowser, ...GALAXY_S5 } = devices['Galaxy S5'];
const CLICK_BLOCKED_MS = 2_000;
const HIT_CONTROL = 'control';
const HIT_BANNER = 'consent banner';
const PANEL = '.dlz-consent__panel';
const PANEL_OVER_VIEWPORT = 'position:fixed;inset:0;width:100vw;max-width:none;height:100vh;max-height:none';

const VIEWPORTS = [
  { name: '360x640', size: { width: 360, height: 640 }, use: GALAXY_S5 },
  { name: '1280x800', size: { width: 1280, height: 800 }, use: DESKTOP },
];
const CONTROLS: { name: string; find: (page: Page) => Locator; path: string; screen: string }[] = [
  { name: 'Start', find: (page) => page.getByTestId('start-tracker'), path: '/tracker', screen: 'jinx-tracker-screen' },
  { name: 'Recolour', find: (page) => page.locator('a[href*="/recolour?id="]'), path: '/recolour', screen: 'jinx-recolour-screen' },
];

async function openPatternWithBannerOpen(page: Page): Promise<void> {
  await page.goto(`/patterns/${await livePatternSlug(page.request)}`);
  const banner = page.getByTestId(CONSENT_BANNER);
  await expect(banner).toBeVisible();
  await banner.evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
}

async function topmostAtCentre(control: Locator): Promise<string> {
  return control.evaluate(
    (el, { bannerId, hitControl, hitBanner }) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (top === null) return 'nothing, centre is outside the viewport';
      if (el.contains(top)) return hitControl;
      if (top.closest(`[data-testid="${bannerId}"]`) !== null) return hitBanner;
      return `${top.tagName}.${top.className}`;
    },
    { bannerId: CONSENT_BANNER, hitControl: HIT_CONTROL, hitBanner: HIT_BANNER },
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name}`, () => {
    test.use({ ...viewport.use, viewport: viewport.size, storageState: { cookies: [], origins: [] } });

    for (const control of CONTROLS) {
      test(`Regression D-BEAD-33 ${control.name} on a pattern page with the consent banner open at ${viewport.name}, is the topmost element and the click reaches ${control.path}`, async ({ page }) => {
        const writes = recordWrites(page);
        await openPatternWithBannerOpen(page);
        const target = control.find(page);

        const topmost = await topmostAtCentre(target);
        await target.click();

        expect(topmost, `${control.name} centre is covered`).toBe(HIT_CONTROL);
        await expect(page.getByTestId(control.screen)).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(control.path);
        expect(writes).toEqual([]);
      });

      test(`Regression D-BEAD-33 control, consent panel forced over ${control.name} at ${viewport.name}, the hit test names the banner and the click never leaves the page`, async ({ page }) => {
        await openPatternWithBannerOpen(page);
        const target = control.find(page);
        const patternUrl = page.url();
        await page.locator(PANEL).evaluate((el, css) => { (el as HTMLElement).style.cssText = css; }, PANEL_OVER_VIEWPORT);

        const topmost = await topmostAtCentre(target);
        const click = target.click({ timeout: CLICK_BLOCKED_MS });

        expect(topmost).toBe(HIT_BANNER);
        await expect(click).rejects.toThrow();
        expect(page.url()).toBe(patternUrl);
      });
    }
  });
}

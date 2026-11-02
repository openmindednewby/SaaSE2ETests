import { expect, test, type Locator, type Page } from '@playwright/test';

import { CONSENT_BANNER, CONSENT_REJECT, DESKTOP, livePatternSlug, PHONE } from './helpers/screens';

const CONSENT_ACCEPT = 'cookie-consent-accept-all';
const RECTANGLE_WIDTH = 300;
const RECTANGLE_HEIGHT = 250;
const CLS_LIMIT = 0.1;
const AD_HOSTS = /googlesyndication|doubleclick|googleadservices|adservice\.google|adnxs|amazon-adsystem|taboola|outbrain|criteo|rubiconproject|pubmatic/;
const VIEWPORTS = [
  { label: '360x640', use: PHONE },
  { label: '1280x800', use: DESKTOP },
];

function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

function foreignHosts(urls: string[], baseURL: string): string[] {
  const own = new URL(baseURL).host;
  return urls.filter((url) => url.startsWith('http') && new URL(url).host !== own);
}

async function expectDarkBox(slot: Locator): Promise<void> {
  const host = slot.locator('[data-ad-slot]');
  await expect(host).toHaveAttribute('data-ad-state', 'dark');
  await expect(host).toHaveAttribute('data-ad-format', 'rectangle');
  await expect(host).toBeEmpty();
  const box = await host.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(RECTANGLE_WIDTH);
  expect(box?.height).toBe(RECTANGLE_HEIGHT);
}

async function expectHouseNoteFills(slot: Locator): Promise<void> {
  const note = slot.getByTestId('ad-house');
  await expect(note).toBeVisible();
  await expect(note.locator('strong')).not.toBeEmpty();
  const fit = await note.evaluate((el) => ({ wide: el.scrollWidth - el.clientWidth, tall: el.scrollHeight - el.clientHeight }));
  expect(fit).toEqual({ wide: 0, tall: 0 });
  expect((await note.boundingBox())?.height).toBe(RECTANGLE_HEIGHT);
}

async function readLayoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve(total), 500);
      }),
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    test(`AC-44 No publisher id set, Load browse and pattern, accept consent, Slot box reserved; zero requests to ad hosts, ${viewport.label}`, async ({ page, request, baseURL }) => {
      const slug = await livePatternSlug(request);
      const requests = recordRequests(page);

      for (const path of ['/browse', `/patterns/${slug}`]) {
        await page.goto(path);
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        const slot = page.getByTestId('ad-slot');
        await expectDarkBox(slot);
        await page.getByTestId(CONSENT_ACCEPT).click();
        await expect(page.getByTestId(CONSENT_BANNER)).toBeHidden();
        await page.waitForLoadState('networkidle');
        await expectDarkBox(slot);
        await expectHouseNoteFills(slot);
        await page.reload();
        await page.waitForLoadState('networkidle');
        await expectDarkBox(slot);
      }

      expect(requests.filter((url) => AD_HOSTS.test(url))).toEqual([]);
      expect(foreignHosts(requests, baseURL as string)).toEqual([]);
    });

    for (const choice of [CONSENT_REJECT, CONSENT_ACCEPT]) {
      test(`AC-45 Site side, no publisher id, ${choice}, no ad request and CLS under 0.1, ${viewport.label}`, async ({ page, request, baseURL }) => {
        const slug = await livePatternSlug(request);
        const requests = recordRequests(page);
        await page.goto(`/patterns/${slug}`);
        const before = await page.getByTestId('ad-slot').boundingBox();

        await page.getByTestId(choice).click();
        await expect(page.getByTestId(CONSENT_BANNER)).toBeHidden();
        await page.waitForLoadState('networkidle');

        expect((await page.getByTestId('ad-slot').boundingBox())?.height).toBe(before?.height);
        await expectDarkBox(page.getByTestId('ad-slot'));
        expect(await readLayoutShift(page)).toBeLessThan(CLS_LIMIT);
        expect(foreignHosts(requests, baseURL as string)).toEqual([]);
      });
    }
  });
}

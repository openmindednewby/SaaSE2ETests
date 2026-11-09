import { devices, expect, test, type Locator, type Page } from '@playwright/test';

test.use({ ...devices['Pixel 5'], viewport: { width: 360, height: 640 } });
test.skip(process.env.JINX_SITE_STUB !== '1', 'Needs the stub API');

const CONSENT_PANEL = '.dlz-consent__panel';

function sheetOf(page: Page): Locator {
  return page.getByTestId('browse-filter-sheet');
}

async function isTopmostAt(target: Locator, offsetY: number | null): Promise<boolean> {
  return target.evaluate((element, offset) => {
    const box = element.getBoundingClientRect();
    const y = offset === null ? box.top + box.height / 2 : box.top + offset;
    const hit = document.elementFromPoint(box.left + box.width / 2, y);
    return hit !== null && element.contains(hit);
  }, offsetY);
}

async function rejectConsent(page: Page): Promise<void> {
  await page.getByTestId('cookie-consent-reject-all').click();
  await expect(page.locator(CONSENT_PANEL)).toBeHidden();
}

async function openSheet(page: Page): Promise<void> {
  await page.getByTestId('browse-filters-open').click();
  await expect(sheetOf(page)).toBeVisible();
}

test('AC-F-4 first visit to /browse at 360x640 with consent open, first card top is inside the viewport with no scroll', async ({ page }) => {
  const foldPx = 640;
  const unscrolledPx = 0;
  const pixelBelowCardTop = 1;
  const firstCard = page.getByTestId('pattern-card').first();

  await page.goto('/browse');

  await expect.poll(() => isTopmostAt(firstCard, pixelBelowCardTop)).toBe(true);
  const placement = await firstCard.evaluate((card) => ({ top: card.getBoundingClientRect().top, scrollY: window.scrollY, viewport: window.innerHeight }));
  expect(placement.viewport).toBe(foldPx);
  expect(placement.scrollY).toBe(unscrolledPx);
  expect(placement.top).toBeGreaterThanOrEqual(unscrolledPx);
  expect(placement.top).toBeLessThan(foldPx);
});

test('AC-F-4 filters opener tapped at 360x640, sheet opens and focus moves to the first filter', async ({ page }) => {
  const firstFilter = page.locator('select[name=stitch]');
  await page.goto('/browse');
  await rejectConsent(page);

  await page.getByTestId('browse-filters-open').click();

  await expect(sheetOf(page)).toBeVisible();
  await expect(firstFilter).toBeFocused();
});

test('AC-F-4 Escape in the open sheet, sheet closes and focus returns to the opener', async ({ page }) => {
  const opener = page.getByTestId('browse-filters-open');
  await page.goto('/browse');
  await rejectConsent(page);
  await openSheet(page);
  await expect(page.locator('select[name=stitch]')).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(sheetOf(page)).toBeHidden();
  await expect(opener).toBeFocused();
});

test('AC-F-4 consent open and sheet open, sheet sits above the consent card and its submit takes the click', async ({ page }) => {
  const toleratedPx = 1;
  const apply = page.getByTestId('browse-filters-apply');
  const consent = page.locator(CONSENT_PANEL);
  await page.goto('/browse');
  await expect(consent).toBeVisible();
  await openSheet(page);
  const overlapPx = async (): Promise<number> => {
    const sheetBox = await sheetOf(page).boundingBox();
    const consentBox = await consent.boundingBox();
    return (sheetBox?.y ?? 0) + (sheetBox?.height ?? 0) - (consentBox?.y ?? 0);
  };
  await expect.poll(overlapPx).toBeLessThanOrEqual(toleratedPx);
  await expect.poll(() => isTopmostAt(apply, null)).toBe(true);

  await apply.click();

  await expect(page).toHaveURL(/\/browse(\?[^#]*)?$/);
  await expect(sheetOf(page)).toBeHidden();
  await expect(consent).toBeVisible();
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false, contextOptions: { reducedMotion: 'reduce' } });

  test('AC-F-4 no JavaScript, the opener link shows the sheet', async ({ page }) => {
    await page.goto('/browse');

    await page.getByTestId('browse-filters-open').click();

    await expect(page).toHaveURL(/\/browse#browse-filters$/);
    await expect(sheetOf(page)).toBeVisible();
    await expect(page.locator('select[name=stitch]')).toBeVisible();
  });

  test('AC-F-4 no JavaScript, stitch peyote submitted from the sheet, only peyote cards return', async ({ page }) => {
    const stitch = 'peyote';
    await page.goto('/browse');
    await openSheet(page);
    await page.locator('select[name=stitch]').selectOption(stitch);

    await page.getByTestId('browse-filters-apply').click();

    await expect(page).toHaveURL(/[?&]stitch=peyote(&|$)/);
    const stitches = await page.locator('[data-stitch]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-stitch')));
    expect(new Set(stitches)).toEqual(new Set([stitch]));
  });
});

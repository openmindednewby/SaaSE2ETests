import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export async function expectRowAffordances(page: Page, row: Locator): Promise<void> {
  await expect(row, 'first row').toBeVisible({ timeout: 20_000 });
  const cursor = await row.evaluate((el) => getComputedStyle(el).cursor);
  expect(cursor, 'row cursor').toBe('pointer');
  const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  await row.hover();
  await expect.poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor), { message: 'hover tint' }).not.toBe(before);
  await row.focus();
  const outline = await row.evaluate((el) => `${getComputedStyle(el).outlineStyle} ${getComputedStyle(el).boxShadow}`);
  expect(outline, 'focus ring').not.toBe('none none');
  await page.keyboard.press('Enter');
}

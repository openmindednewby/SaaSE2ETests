import { expect, test } from '@playwright/test';

test('AC-12 Live site, Open /attribution, MakeBead credit and CC BY 4.0 link present', async ({ page }) => {
  const response = await page.goto('/attribution');

  const credit = page.getByTestId('makebead-link');

  expect(response?.status()).toBe(200);
  await expect(credit).toHaveAttribute('href', 'https://makebead.com');
  await expect(page.getByTestId('cc-by-link')).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
});

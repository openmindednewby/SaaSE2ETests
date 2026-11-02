import { expect, type Page } from '@playwright/test';

export const APP_URL = process.env.JINX_APP_URL ?? 'http://unconfigured.invalid';

export async function openNewTracker(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/make`);
  await page.getByTestId('jinx-generator-start').click();
  await expect(page.getByTestId('jinx-tracker-screen')).toBeVisible();
}

export async function pressNextRowTo(page: Page, row: number): Promise<void> {
  await page.getByTestId('jinx-tracker-next-row').click();
  while (!(await page.getByTestId('jinx-tracker-row').innerText()).endsWith(` ${row}`)) {
    await page.getByTestId('jinx-tracker-next-row').click();
  }
  await expect(page.getByTestId('jinx-tracker-row')).toHaveText(`Row ${row}`);
}

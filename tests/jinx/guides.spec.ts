import { expect, test } from '@playwright/test';

import { GUIDE_SLUGS } from './helpers/screens';

const SITE = 'https://jinxbeadpatterns.dloizides.com';
const SITEMAP = '/sitemap-static.xml';

for (const slug of GUIDE_SLUGS) {
  test(`AC-04 Guide ${slug}, Open guide, 200, finishing steps, in sitemap`, async ({ page, request }) => {
    const response = await page.goto(`/guides/${slug}`);

    const steps = page.getByTestId('guide-steps').locator('li');

    expect(response?.status()).toBe(200);
    expect(await steps.count()).toBeGreaterThan(0);
    expect(await (await request.get(SITEMAP)).text()).toContain(`<loc>${SITE}/guides/${slug}</loc>`);
  });
}

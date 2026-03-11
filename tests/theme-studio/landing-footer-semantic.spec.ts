import { expect, Page, test } from '@playwright/test';

/**
 * E2E Tests for Landing Page Footer Semantic Element.
 *
 * Verifies that the landing page uses a semantic <footer> HTML element
 * and that it contains expected content such as copyright text and
 * navigation links.
 *
 * @tag @theme-studio @accessibility @semantic-html @bug-verification
 */

const STUDIO_BASE_URL = 'http://localhost:4444';

test.describe('Landing Page Footer Semantic Element @theme-studio @accessibility @semantic-html', () => {
  test.setTimeout(60000);

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto(STUDIO_BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    // Wait for the landing page to render
    await expect(
      page.locator('[data-testid="landing-page"]'),
    ).toBeVisible({ timeout: 15000 });
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test('should have a semantic <footer> HTML element on the landing page', async () => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });

  test('should have a footer with the correct data-testid', async () => {
    const footer = page.locator('[data-testid="landing-footer"]');
    await expect(footer).toBeVisible();

    // Verify the element is actually a <footer> tag
    const tagName = await footer.evaluate((el) => el.tagName.toLowerCase());
    expect(
      tagName,
      'The landing-footer element should be a semantic <footer> tag',
    ).toBe('footer');
  });

  test('should contain copyright text in the footer', async () => {
    const footer = page.locator('[data-testid="landing-footer"]');
    const currentYear = new Date().getFullYear().toString();

    // Footer should contain a copyright notice with the current year
    await expect(footer).toContainText(currentYear);
  });

  test('should contain a Pricing link in the footer', async () => {
    const pricingLink = page.locator('[data-testid="landing-footer-pricing"]');
    await expect(pricingLink).toBeVisible();

    // Verify it is a proper link (anchor tag or similar)
    const tagName = await pricingLink.evaluate((el) => el.tagName.toLowerCase());
    expect(
      tagName,
      'Pricing footer element should be a link',
    ).toBe('a');
  });

  test('should contain a Login link in the footer', async () => {
    const loginLink = page.locator('[data-testid="landing-footer-login"]');
    await expect(loginLink).toBeVisible();

    const tagName = await loginLink.evaluate((el) => el.tagName.toLowerCase());
    expect(
      tagName,
      'Login footer element should be a link',
    ).toBe('a');
  });

  test('should have footer links with valid href attributes', async () => {
    const pricingLink = page.locator('[data-testid="landing-footer-pricing"]');
    const loginLink = page.locator('[data-testid="landing-footer-login"]');

    const pricingHref = await pricingLink.getAttribute('href');
    const loginHref = await loginLink.getAttribute('href');

    expect(
      pricingHref,
      'Pricing link should have an href attribute',
    ).toBeTruthy();
    expect(
      loginHref,
      'Login link should have an href attribute',
    ).toBeTruthy();

    // Verify hrefs point to expected routes
    expect(pricingHref).toContain('pricing');
    expect(loginHref).toContain('login');
  });

  test('should have the footer positioned at the bottom of the page', async () => {
    const footer = page.locator('[data-testid="landing-footer"]');
    const main = page.locator('[data-testid="landing-page"]');

    const footerBox = await footer.boundingBox();
    const mainBox = await main.boundingBox();

    expect(footerBox, 'Footer should have a bounding box').toBeTruthy();
    expect(mainBox, 'Main content should have a bounding box').toBeTruthy();

    if (footerBox && mainBox) {
      // Footer should be near the bottom of the main content
      const footerBottom = footerBox.y + footerBox.height;
      const mainBottom = mainBox.y + mainBox.height;

      expect(
        Math.abs(footerBottom - mainBottom),
        'Footer bottom should align with main content bottom',
      ).toBeLessThan(5);
    }
  });
});

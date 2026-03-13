const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:8082';
const OUTPUT_DIR = path.join(__dirname, 'visual-qa-screenshots', 'legal-modals');

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => {
    consoleErrors.push('PAGE_ERROR: ' + err.message);
  });

  const networkErrors = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      networkErrors.push(response.status() + ' ' + response.url());
    }
  });

  console.log('=== Phase 1: Navigate to login page ===');
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Clear cookie consent to see banner
  await page.evaluate(() => localStorage.removeItem('COOKIE_CONSENT'));
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, '01-login-page-desktop.png'), fullPage: true });
  console.log('Screenshot: 01-login-page-desktop.png');

  // Check if footer links exist
  const privacyLink = page.locator('[data-testid="login-privacy-link"]');
  const termsLink = page.locator('[data-testid="login-terms-link"]');
  const privacyLinkCount = await privacyLink.count();
  const termsLinkCount = await termsLink.count();
  console.log('Privacy link found:', privacyLinkCount > 0);
  console.log('Terms link found:', termsLinkCount > 0);

  // Check footer link text
  if (privacyLinkCount > 0) {
    const privacyText = await privacyLink.textContent();
    console.log('Privacy link text:', privacyText);
  }
  if (termsLinkCount > 0) {
    const termsText = await termsLink.textContent();
    console.log('Terms link text:', termsText);
  }

  // Check cookie consent banner
  const cookieBanner = page.locator('[data-testid="cookie-consent-banner"]');
  const cookieBannerCount = await cookieBanner.count();
  console.log('Cookie consent banner found:', cookieBannerCount > 0);

  if (cookieBannerCount > 0) {
    await page.screenshot({ path: path.join(OUTPUT_DIR, '02-cookie-consent-banner.png'), fullPage: true });
    console.log('Screenshot: 02-cookie-consent-banner.png');
  }

  // Test Privacy Policy modal from login footer
  console.log('');
  console.log('=== Phase 2: Test Privacy Policy Modal from login footer ===');
  if (privacyLinkCount > 0) {
    await privacyLink.click();
    await page.waitForTimeout(1000);

    const ppScreen = page.locator('[data-testid="privacy-policy-screen"]');
    const ppVisible = await ppScreen.count();
    console.log('Privacy Policy modal visible:', ppVisible > 0);

    if (ppVisible > 0) {
      await page.screenshot({ path: path.join(OUTPUT_DIR, '03-privacy-policy-modal.png'), fullPage: true });
      console.log('Screenshot: 03-privacy-policy-modal.png');

      // Check title
      const titleEl = ppScreen.locator('div').filter({ hasText: /^Privacy Policy$/ }).first();
      const titleText = await titleEl.textContent().catch(() => 'NOT_FOUND');
      console.log('Title text:', titleText);

      // Check last updated
      const lastUpdatedEl = ppScreen.locator('div').filter({ hasText: /Last updated/ }).first();
      const lastUpdatedText = await lastUpdatedEl.textContent().catch(() => 'NOT_FOUND');
      console.log('Last updated text:', lastUpdatedText);

      // Count sections (look for section titles like "1.", "2.", etc.)
      const sectionCount = await ppScreen.locator('div').filter({ hasText: /^\d+\.\s/ }).count().catch(() => 0);
      console.log('Sections found:', sectionCount);

      // Check close button
      const closeBtn = page.locator('[data-testid="privacy-policy-close"]');
      const closeBtnCount = await closeBtn.count();
      console.log('Close button found:', closeBtnCount > 0);

      // Check close button size
      if (closeBtnCount > 0) {
        const closeBtnBox = await closeBtn.boundingBox();
        if (closeBtnBox) {
          console.log('Close button size:', Math.round(closeBtnBox.width) + 'x' + Math.round(closeBtnBox.height));
          console.log('Close button meets 44x44 min:', closeBtnBox.width >= 44 && closeBtnBox.height >= 44);
        }
      }

      // Check modal background color
      const bgColor = await ppScreen.evaluate(el => {
        return window.getComputedStyle(el).backgroundColor;
      });
      console.log('Modal background color:', bgColor);

      // Scroll down to check content renders
      const scrollable = ppScreen.locator('[role="dialog"]');
      if (await scrollable.count() > 0) {
        await scrollable.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '04-privacy-policy-scrolled.png'), fullPage: true });
        console.log('Screenshot: 04-privacy-policy-scrolled.png');
      }

      // Close the modal
      if (closeBtnCount > 0) {
        await closeBtn.click();
        await page.waitForTimeout(500);
        const ppAfterClose = await page.locator('[data-testid="privacy-policy-screen"]').count();
        console.log('Modal closed successfully:', ppAfterClose === 0);
      }
    }
  }

  // Test Terms of Service modal from login footer
  console.log('');
  console.log('=== Phase 3: Test Terms of Service Modal from login footer ===');
  if (termsLinkCount > 0) {
    await termsLink.click();
    await page.waitForTimeout(1000);

    const tosScreen = page.locator('[data-testid="terms-of-service-screen"]');
    const tosVisible = await tosScreen.count();
    console.log('Terms of Service modal visible:', tosVisible > 0);

    if (tosVisible > 0) {
      await page.screenshot({ path: path.join(OUTPUT_DIR, '05-terms-of-service-modal.png'), fullPage: true });
      console.log('Screenshot: 05-terms-of-service-modal.png');

      // Check title
      const tosTitle = tosScreen.locator('div').filter({ hasText: /^Terms of Service$/ }).first();
      const tosTitleText = await tosTitle.textContent().catch(() => 'NOT_FOUND');
      console.log('Title text:', tosTitleText);

      // Check close button
      const tosCloseBtn = page.locator('[data-testid="terms-of-service-close"]');
      const tosCloseBtnCount = await tosCloseBtn.count();
      console.log('Close button found:', tosCloseBtnCount > 0);

      // Close the modal
      if (tosCloseBtnCount > 0) {
        await tosCloseBtn.click();
        await page.waitForTimeout(500);
        const tosAfterClose = await page.locator('[data-testid="terms-of-service-screen"]').count();
        console.log('Modal closed successfully:', tosAfterClose === 0);
      }
    }
  }

  // Test Privacy Policy modal from cookie consent banner
  console.log('');
  console.log('=== Phase 4: Test Privacy Policy from Cookie Consent Banner ===');
  if (cookieBannerCount > 0) {
    const cookiePrivacyLink = page.locator('[data-testid="cookie-consent-privacy-link"]');
    const cookiePrivacyCount = await cookiePrivacyLink.count();
    console.log('Cookie banner privacy link found:', cookiePrivacyCount > 0);

    if (cookiePrivacyCount > 0) {
      await cookiePrivacyLink.click();
      await page.waitForTimeout(1000);

      const ppFromCookie = page.locator('[data-testid="privacy-policy-screen"]');
      const ppFromCookieVisible = await ppFromCookie.count();
      console.log('Privacy Policy modal from cookie banner visible:', ppFromCookieVisible > 0);

      if (ppFromCookieVisible > 0) {
        await page.screenshot({ path: path.join(OUTPUT_DIR, '06-privacy-from-cookie-banner.png'), fullPage: true });
        console.log('Screenshot: 06-privacy-from-cookie-banner.png');

        // Close modal
        const closeBtn2 = page.locator('[data-testid="privacy-policy-close"]');
        if (await closeBtn2.count() > 0) {
          await closeBtn2.click();
          await page.waitForTimeout(500);
          console.log('Modal from cookie banner closed');
        }

        // Check cookie banner is still visible after closing privacy modal
        const bannerStillVisible = await cookieBanner.count();
        console.log('Cookie banner still visible after closing modal:', bannerStillVisible > 0);

        await page.screenshot({ path: path.join(OUTPUT_DIR, '07-after-closing-privacy-from-banner.png'), fullPage: true });
        console.log('Screenshot: 07-after-closing-privacy-from-banner.png');
      }
    }
  }

  // Test responsive breakpoints
  console.log('');
  console.log('=== Phase 5: Responsive Testing ===');

  // Tablet
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '08-login-tablet.png'), fullPage: true });
  console.log('Screenshot: 08-login-tablet.png');

  // Open privacy modal on tablet
  const privacyLinkTablet = page.locator('[data-testid="login-privacy-link"]');
  if (await privacyLinkTablet.count() > 0) {
    await privacyLinkTablet.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '09-privacy-modal-tablet.png'), fullPage: true });
    console.log('Screenshot: 09-privacy-modal-tablet.png');
    const closeBtnTab = page.locator('[data-testid="privacy-policy-close"]');
    if (await closeBtnTab.count() > 0) await closeBtnTab.click();
    await page.waitForTimeout(300);
  }

  // Mobile
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '10-login-mobile.png'), fullPage: true });
  console.log('Screenshot: 10-login-mobile.png');

  const privacyLinkMobile = page.locator('[data-testid="login-privacy-link"]');
  if (await privacyLinkMobile.count() > 0) {
    await privacyLinkMobile.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '11-privacy-modal-mobile.png'), fullPage: true });
    console.log('Screenshot: 11-privacy-modal-mobile.png');

    // Check close button size on mobile
    const closeBtnMobile = page.locator('[data-testid="privacy-policy-close"]');
    if (await closeBtnMobile.count() > 0) {
      const mobileBox = await closeBtnMobile.boundingBox();
      if (mobileBox) {
        console.log('Close button size on mobile:', Math.round(mobileBox.width) + 'x' + Math.round(mobileBox.height));
        console.log('Close button meets 44x44 on mobile:', mobileBox.width >= 44 && mobileBox.height >= 44);
      }
      await closeBtnMobile.click();
    }
    await page.waitForTimeout(300);
  }

  // Open terms modal on mobile
  const termsLinkMobile = page.locator('[data-testid="login-terms-link"]');
  if (await termsLinkMobile.count() > 0) {
    await termsLinkMobile.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '12-terms-modal-mobile.png'), fullPage: true });
    console.log('Screenshot: 12-terms-modal-mobile.png');
    const closeBtnTos = page.locator('[data-testid="terms-of-service-close"]');
    if (await closeBtnTos.count() > 0) await closeBtnTos.click();
    await page.waitForTimeout(300);
  }

  // Accessibility check
  console.log('');
  console.log('=== Phase 6: Accessibility Check ===');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);

  // Check login footer links accessibility
  const footerA11y = await page.evaluate(() => {
    const results = [];
    const privLink = document.querySelector('[data-testid="login-privacy-link"]');
    const termsLink = document.querySelector('[data-testid="login-terms-link"]');

    [privLink, termsLink].forEach(el => {
      if (!el) return;
      results.push({
        testId: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        tabIndex: el.tabIndex,
        text: el.textContent,
      });
    });
    return results;
  });
  console.log('Footer links accessibility:');
  footerA11y.forEach(el => {
    console.log('  ' + el.testId + ': role=' + el.role + ' aria-label="' + el.ariaLabel + '" tabIndex=' + el.tabIndex + ' text="' + el.text + '"');
  });

  // Open privacy modal and check interactive elements
  if (await privacyLinkTablet.count() > 0) {
    await privacyLinkTablet.click();
    await page.waitForTimeout(500);

    const interactiveElements = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="privacy-policy-screen"]');
      if (!modal) return [];
      const interactive = modal.querySelectorAll('button, a, [role="button"], [role="link"], [tabindex], input, select, textarea');
      return Array.from(interactive).map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        text: (el.textContent || '').trim().substring(0, 50),
        tabIndex: el.tabIndex,
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
      }));
    });
    console.log('Interactive elements in Privacy Policy modal:');
    interactiveElements.forEach(el => {
      const sizeOk = el.width >= 44 && el.height >= 44;
      console.log('  ' + el.tag + ' role=' + el.role + ' aria-label="' + el.ariaLabel + '" size=' + el.width + 'x' + el.height + ' sizeOk=' + sizeOk);
    });

    // Check dialog role and aria attributes
    const dialogA11y = await page.evaluate(() => {
      const scrollView = document.querySelector('[role="dialog"]');
      if (!scrollView) return null;
      return {
        role: scrollView.getAttribute('role'),
        ariaLabel: scrollView.getAttribute('aria-label'),
        ariaModal: scrollView.getAttribute('aria-modal'),
      };
    });
    console.log('Dialog accessibility:', JSON.stringify(dialogA11y));

    const closeBtn5 = page.locator('[data-testid="privacy-policy-close"]');
    if (await closeBtn5.count() > 0) await closeBtn5.click();
    await page.waitForTimeout(300);
  }

  // Summary
  console.log('');
  console.log('=== Summary ===');
  console.log('Console errors:', consoleErrors.length);
  consoleErrors.forEach(e => console.log('  [ERROR] ' + e.substring(0, 300)));
  console.log('Network errors:', networkErrors.length);
  networkErrors.forEach(e => console.log('  [NET] ' + e.substring(0, 300)));

  await context.close();
  await browser.close();
  console.log('Done!');
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

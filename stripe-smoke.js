/**
 * Phase 5 live Stripe-checkout smoke test.
 *
 * Drives the kefi-owner flow end-to-end:
 *   1. Login at v2.kizombaunioncy.dloizides.com/login (password tab)
 *   2. Visit /organizer/pricing
 *   3. Click Upgrade to Pro
 *   4. On the redirect to checkout.stripe.com:
 *      - Fill email, card 4242 4242 4242 4242, exp 12/30, CVC 123, name, postcode
 *      - Submit
 *   5. Wait for the success redirect back to /organizer/pricing
 *
 * The webhook handler updates KefiDB asynchronously — verify post-flow via
 * the /admin/subscription endpoint (separate curl).
 *
 * Credentials are read from the environment so they're never committed:
 *   KEFI_OWNER_USER=<test-username>  (defaults to "kefi-owner")
 *   KEFI_OWNER_PASS=<test-password>  (required)
 *
 * Example:
 *   KEFI_OWNER_USER=kefi-owner KEFI_OWNER_PASS='...' node stripe-smoke.js
 */
const { chromium } = require('@playwright/test');

const BASE = 'https://v2.kizombaunioncy.dloizides.com';
const USER = process.env.KEFI_OWNER_USER || 'kefi-owner';
const PASS = process.env.KEFI_OWNER_PASS;
if (!PASS) {
  console.error('FATAL: set KEFI_OWNER_PASS env var before running this smoke test.');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Surface page errors + console issues to my stdout for debugging.
  page.on('console', m => {
    if (m.type() === 'error') console.error(`[console.error] ${m.text()}`);
  });
  page.on('pageerror', e => console.error(`[pageerror] ${e.message}`));

  console.log('-> Navigating to login');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  // Password tab might not be the default — let's read what's there
  console.log('-> Login URL:', page.url());

  // Fill username + password (the Password tab should be default per LoginForm)
  // testIDs from the @dloizides/auth-web LoginForm are not certain here;
  // use stable selector by name/placeholder.
  await page.fill('input[name="username"], input[autocomplete*="username"]', USER).catch(() => {});
  await page.fill('input[type="password"], input[name="password"]', PASS).catch(() => {});

  // Click Sign in
  console.log('-> Submitting login');
  await Promise.all([
    page.waitForURL(/\/organizer/, { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("Sign in")').catch(() => {}),
  ]);
  console.log('-> Post-login URL:', page.url());
  await page.screenshot({ path: 'C:/desktopContents/projects/SaaS/scratch/stripe-1-postlogin.png' });

  console.log('-> Navigating to /organizer/pricing');
  await page.goto(`${BASE}/organizer/pricing`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'C:/desktopContents/projects/SaaS/scratch/stripe-2-pricing.png' });

  // Click Upgrade to Pro — try a few text variants
  console.log('-> Clicking Upgrade to Pro');
  const upgradeButton = page.getByRole('button', { name: /upgrade to pro/i }).first();
  await upgradeButton.waitFor({ timeout: 15000 });
  await Promise.all([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }),
    upgradeButton.click(),
  ]);
  console.log('-> On Stripe Checkout:', page.url());
  // networkidle hangs because Stripe's third-party Amazon Pay CORS calls never
  // resolve. domcontentloaded + waiting for #cardNumber is sufficient.
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#cardNumber', { timeout: 30000 });
  await page.screenshot({ path: 'C:/desktopContents/projects/SaaS/scratch/stripe-3-checkout.png' });

  // Stripe Checkout form — use Stripe's stable input IDs/names
  console.log('-> Filling card details');

  // Email (top of the form)
  await page.fill('#email', `kefi-smoke+${Date.now()}@dloizides.com`);

  // Card number — Stripe Checkout uses #cardNumber
  await page.fill('#cardNumber', '4242424242424242');
  await page.fill('#cardExpiry', '12 / 30');
  await page.fill('#cardCvc', '123');
  await page.fill('#billingName', 'Kefi Owner');

  // Postal code — some flows show it, some don't, fill if present.
  const postal = page.locator('#billingPostalCode');
  if (await postal.count()) {
    await postal.first().fill('1010');
  }

  await page.screenshot({ path: 'C:/desktopContents/projects/SaaS/scratch/stripe-4-filled.png' });

  // Submit. The pay button text varies — try common variants.
  console.log('-> Submitting payment');
  const payButton = page.locator('button[data-testid="hosted-payment-submit-button"]').first();
  await payButton.waitFor({ timeout: 10000 });
  await Promise.all([
    page.waitForURL(/v2\.kizombaunioncy\.dloizides\.com.*pricing/i, { timeout: 60000 }),
    payButton.click(),
  ]);

  console.log('-> Post-checkout URL:', page.url());
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:/desktopContents/projects/SaaS/scratch/stripe-5-success.png' });

  console.log('-> DONE — checkout submitted successfully.');
  await browser.close();
})().catch(async (err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

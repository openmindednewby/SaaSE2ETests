import { devices, test, type Page } from '@playwright/test';
import * as fs from 'fs';
const ORIGIN = 'https://aml-screening.dloizides.com';
const SHOT = process.env.SIGHT_OUT ?? 'C:/desktopContents/projects/SaaS/BaseClient/docs/Tasks/IN_PROGRESS/proovid-amlservice/ERIC-SETTLE-1-settle-eric-points-655-269-652/sightings/2026-11-14';
const OUT = SHOT + '/eric-settle-result.json';
const { defaultBrowserType: _d, ...D1280 } = devices['Desktop Chrome'];
const { defaultBrowserType: _m, ...S5 } = devices['Galaxy S5'];
void _d; void _m;
const VPS = [{ n: 'm360', dev: S5, vp: { width: 360, height: 640 } }, { n: 'd1280', dev: D1280, vp: { width: 1280, height: 800 } }];
async function signIn(page: Page) {
  await page.goto(ORIGIN + '/bff/passkey/login?returnUrl=' + encodeURIComponent('/app/'), { timeout: 45000 });
  await page.locator('input#email, input[type="email"]').first().fill(process.env.AML_TESTER_EMAIL!);
  await page.locator('input#password, input[type="password"]').first().fill(process.env.AML_TESTER_PASSWORD!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(u => u.host === 'aml-screening.dloizides.com', { timeout: 45000 });
}
const fit = (page: Page) => page.evaluate(() => {
  const over: string[] = [];
  document.querySelectorAll('button,[role=button],a,[role=combobox],input,[role=option]').forEach(e => {
    const el = e as HTMLElement; const r = el.getBoundingClientRect(); if (!r.width) return;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') over.push((el.getAttribute('data-testid') || el.innerText || '').slice(0, 40));
    if (r.right > innerWidth + 1) over.push('OFFVP ' + (el.getAttribute('data-testid') || el.innerText || '').slice(0, 40));
  });
  const small = [...document.querySelectorAll('button,[role=button],a,[role=combobox]')].map(e => { const r = (e as HTMLElement).getBoundingClientRect(); return { t: (e.getAttribute('data-testid') || '').slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w > 0 && (x.w < 44 || x.h < 44)).slice(0, 8);
  return { sw: document.documentElement.scrollWidth, vw: innerWidth, over: over.slice(0, 10), small };
});
for (const v of VPS) test.describe(v.n, () => {
  test.use({ ...v.dev, viewport: v.vp });
  test('eric-settle ' + v.n, async ({ page }) => {
    test.setTimeout(240000);
    const res: Record<string, unknown> = {}; const cons: string[] = []; const http: string[] = []; const reqs: string[] = [];
    page.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => cons.push('PAGEERROR ' + e.message.slice(0, 200)));
    page.on('request', r => { if (/\/(cases|profiles|decision)/i.test(r.url()) && !/\.(js|css|png)/.test(r.url())) reqs.push(r.method() + ' ' + r.url().replace(ORIGIN, '').slice(0, 160)); });
    page.on('response', r => { if (r.status() >= 400) http.push(r.status() + ' ' + r.request().method() + ' ' + r.url().slice(0, 140)); });
    await signIn(page);
    // 1 cases source filter
    await page.goto(ORIGIN + '/app/cases'); await page.waitForTimeout(5000);
    const c: Record<string, unknown> = {};
    const src = page.locator('[aria-label*="Source"]').first();
    c.sourceControl = await src.count();
    if (c.sourceControl) {
      await src.scrollIntoViewIfNeeded(); await src.click(); await page.waitForTimeout(1200);
      const opt = page.getByText('Verification session', { exact: true });
      c.optionCount = await opt.count(); c.optionsFit = await fit(page);
      await page.screenshot({ path: SHOT + '/' + v.n + '-cases-source-open.png' });
      if (c.optionCount) { const before = reqs.length; await opt.last().click(); await page.waitForTimeout(4000); c.reqsAfter = reqs.slice(before); }
      c.errorBanner = await page.locator('[data-testid$="-error"],[role=alert]').count();
      c.body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
    }
    c.fit = await fit(page);
    await page.screenshot({ path: SHOT + '/' + v.n + '-cases-session.png', fullPage: true });
    res.cases = c;
    // 2 decision matrix initial focus
    await page.goto(ORIGIN + '/app/decision-matrix'); await page.waitForTimeout(6000);
    res.matrix = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const sel = document.querySelector('[data-testid*="profile"]') as HTMLElement | null;
      return { active: a ? (a.getAttribute('data-testid') || a.tagName + ':' + (a.getAttribute('aria-label') || '')).slice(0, 80) : null,
        autofocusAttrs: document.querySelectorAll('[autofocus],[data-menu-default]').length,
        profileTestids: [...document.querySelectorAll('[data-testid*="profile"]')].map(e => e.getAttribute('data-testid')).slice(0, 10),
        barText: sel ? sel.innerText.replace(/\s+/g, ' ').slice(0, 200) : null,
        head: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500) };
    });
    (res.matrix as Record<string, unknown>).fit = await fit(page);
    await page.screenshot({ path: SHOT + '/' + v.n + '-decision-matrix.png', fullPage: true });
    // 3 new profile Enter x2 (desktop only, one write on the test tenant)
    if (v.n === 'd1280') {
      await page.goto(ORIGIN + '/app/decision-profiles'); await page.waitForTimeout(6000);
      const p: Record<string, unknown> = { noAccess: await page.getByTestId('decision-profiles-no-access').count() };
      const name = page.getByTestId('decision-profiles-create-name');
      p.form = await name.count();
      if (p.form) {
        const code = 'QA' + Date.now().toString().slice(-6);
        await page.getByTestId('decision-profiles-create-code').fill(code); await name.fill('QA enter guard ' + code);
        let posts = 0; page.on('request', r => { if (r.method() === 'POST' && /profile/i.test(r.url())) posts++; });
        await name.press('Enter'); await name.press('Enter'); await page.waitForTimeout(5000);
        p.code = code; p.posts = posts;
        p.matches = await page.getByText(code).count();
        await page.screenshot({ path: SHOT + '/d1280-profile-created.png', fullPage: true });
      }
      res.profiles = p;
    }
    res.consoleErrors = cons; res.httpErrors = http; res.reqs = reqs.slice(0, 30);
    const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
    all[v.n] = res; fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  });
});

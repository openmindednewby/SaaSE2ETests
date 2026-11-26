import fs from 'fs';
import { devices, test, type Page } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';
import { SELIDA_APP_BASE } from '../selida/selida-account-helpers.js';

const DIR = 'C:/desktopContents/projects/SaaS/BaseClient/docs/Tasks/IN_PROGRESS/auth-web/AUTH-DARK-1-password-field-theme/sight-1127';
const { defaultBrowserType: _a, ...S5 } = devices['Galaxy S5'];
const { defaultBrowserType: _b, ...DC } = devices['Desktop Chrome'];
void _a; void _b;
const VPS = [
  { n: '360x640', dev: S5, vp: { width: 360, height: 640 } },
  { n: '1280x800', dev: DC, vp: { width: 1280, height: 800 } },
];
const ROUTES = ['/login', '/register', '/forgot-password', '/reset-password?token=sight-bogus&email=sight%40example.com'];

function watch(page: Page) {
  const e: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') e.push(m.text().slice(0, 180)); });
  page.on('pageerror', (x) => e.push('PAGEERROR ' + x.message.slice(0, 180)));
  page.on('response', (r) => { if (r.status() >= 400) e.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  return e;
}

function MEASURE() {
  const lum = (c: string) => {
    const m = c.match(/[\d.]+/g); if (!m) return { L: 1, a: 0, rgb: [255, 255, 255] };
    const rgb = m.slice(0, 3).map(Number);
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return { L: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m[3] === undefined ? 1 : Number(m[3]), rgb };
  };
  const comp = (el: Element | null) => {
    const layers: { rgb: number[]; a: number }[] = [];
    while (el) { const l = lum(getComputedStyle(el).backgroundColor); if (l.a > 0) { layers.push(l); if (l.a >= 1) break; } el = el.parentElement; }
    let c = [255, 255, 255]; for (const l of layers.reverse()) c = c.map((v, i) => v * (1 - l.a) + l.rgb[i] * l.a);
    return `rgb(${c.map(Math.round).join(',')})`;
  };
  const ratio = (a: string, b: string) => { const x = lum(a).L, y = lum(b).L; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const small: string[] = [];
  document.querySelectorAll('button,a,[role="button"],[role="link"],input,[role="checkbox"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (r.width < 44 || r.height < 44)) small.push(`${(el as HTMLElement).dataset.testid ?? el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  const low: string[] = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n: Node | null;
  while ((n = w.nextNode())) {
    const el = n.parentElement; const t = (n.textContent ?? '').trim(); if (!el || !t) continue;
    if (!el.getBoundingClientRect().width || getComputedStyle(el).visibility === 'hidden') continue;
    const k = ratio(getComputedStyle(el).color, comp(el)); const big = parseFloat(getComputedStyle(el).fontSize) >= 24;
    if (k < (big ? 3 : 4.5)) low.push(`${t.slice(0, 24)}:${k.toFixed(2)}`);
  }
  const inputs = [...document.querySelectorAll('input')].filter((i) => i.getBoundingClientRect().width && i.type !== 'checkbox' && i.type !== 'hidden').map((i) => {
    const box = (i.closest('[data-testid]') as HTMLElement | null) ?? i; const r = i.getBoundingClientRect();
    let wrap: HTMLElement | null = i; let bx = r; for (let k = 0; k < 4 && wrap; k++) { if (parseFloat(getComputedStyle(wrap).borderTopWidth) > 0) { bx = wrap.getBoundingClientRect(); break; } wrap = wrap.parentElement; }
    const cs = getComputedStyle(i);
    return { id: (i as HTMLElement).dataset.testid ?? box.dataset.testid ?? i.name, type: i.type, x: Math.round(bx.left), w: Math.round(bx.width), h: Math.round(bx.height), well: comp(i), ink: cs.color, padR: cs.paddingRight, inkRatio: ratio(cs.color, comp(i)).toFixed(2) };
  });
  return { sw: document.documentElement.scrollWidth, vw: innerWidth, bodyBg: comp(document.body), small, lowContrast: low.slice(0, 12), lowCount: low.length, inputs, path: location.pathname };
}

for (const v of VPS) for (const s of ['light', 'dark'] as const) {
  test(`selida auth ${v.n} ${s}`, async ({ browser }) => {
    fs.mkdirSync(DIR, { recursive: true });
    const ctx = await browser.newContext({ ...v.dev, viewport: v.vp, colorScheme: s });
    const page = await ctx.newPage(); const errs = watch(page); const out: Record<string, unknown> = {};
    for (const r of ROUTES) {
      errs.length = 0;
      await page.goto(SELIDA_APP_BASE + r, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const m = await page.evaluate(MEASURE);
      let fit = 'ok'; try { await expectTextFits(page, 'body *'); } catch (e) { fit = (e as Error).message.split('\n').slice(0, 3).join(' | ').slice(0, 300); }
      const name = r.split('?')[0].slice(1);
      await page.screenshot({ path: `${DIR}/${v.n}-${s}-${name}.png`, fullPage: true });
      out[name] = { m, fit, errs: [...new Set(errs)].slice(0, 8) };
    }
    fs.writeFileSync(`${DIR}/${v.n}-${s}.json`, JSON.stringify(out, null, 1));
    await ctx.close();
  });
}

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const STUB_ONLY = process.env.JINX_SITE_STUB === '1';
const MATCH_TITLE = process.env.JINX_BROWSE_MATCH ?? 'Lozenge Band';
const CARD = /data-testid="pattern-card"/g;
const SHOT_DIR = process.env.JINX_SHOT_DIR;
const PHONE = { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const WALK = ['/', '/browse', '/browse?q=zzzznothing', '/patterns/lozenge-band', '/patterns/removed-band', '/guides', '/guides/finish-a-bracelet', '/attribution', '/privacy', '/no-such-page'];
const MIN_HIT = 44;
const MIN_BEAD_PX = 14;
const APP_ORIGIN = 'https://jinx-app.dloizides.com';
const APP_DIR = resolve(__dirname, '../../../apps/jinx-bead-patterns/app');
const APP_LINK_PAGES = ['/', '/browse', '/browse?q=zzzznothing', '/patterns/lozenge-band', '/guides', '/attribution'];

function appRoutes(): Set<string> {
  const routeFiles = [...readdirSync(APP_DIR), ...readdirSync(resolve(APP_DIR, '(auth)'))];
  return new Set(routeFiles.filter((name) => name.endsWith('.tsx') && !name.startsWith('_') && !name.startsWith('+')).map((name) => `/${name.replace('.tsx', '').replace(/^index$/, '')}`));
}

test('AC-01 Live patterns in 3 stitches, GET /browse?stitch=peyote, Only peyote cards in HTML, without JS', async ({ request }) => {
  const response = await request.get('/browse?stitch=peyote');

  const html = await response.text();

  expect(response.status()).toBe(200);
  expect(html.match(CARD)?.length ?? 0).toBeGreaterThan(0);
  expect(html.match(/data-stitch="[a-z]+"/g)?.every((value) => value === 'data-stitch="peyote"')).toBe(true);
});

test('AC-02 Query matches 1 title, Search, That one result; no match shows the empty state', async ({ request }) => {
  const match = await (await request.get(`/browse?q=${encodeURIComponent(MATCH_TITLE)}`)).text();

  const none = await (await request.get('/browse?q=zzzznothing')).text();

  expect(match.match(CARD)?.length).toBe(1);
  expect(match).toContain(MATCH_TITLE);
  expect(none.match(CARD)).toBeNull();
  expect(none).toContain('data-testid="clear-filters"');
});

test.describe('built server with a stub API', () => {
  test.skip(!STUB_ONLY, 'Needs the stub API');

  test('AC-ENTER-browse-search Query typed, Enter, Search runs once', async ({ page, request }) => {
    await page.goto('/browse');
    await expect(page.getByTestId('browse-search-input')).toBeFocused();
    const before = (await (await request.get(`${process.env.JINX_STUB_URL}/__stats`)).json()).searches.filter((search: string) => search.includes('q=Chevron')).length;
    await page.getByTestId('browse-search-input').fill('Chevron');

    await page.getByTestId('browse-search-input').press('Enter');

    await expect(page).toHaveURL(/q=Chevron/);
    await expect(page.getByTestId('pattern-card')).toHaveCount(1);
    const after = (await (await request.get(`${process.env.JINX_STUB_URL}/__stats`)).json()).searches.filter((search: string) => search.includes('q=Chevron')).length;
    expect(after - before).toBe(1);
  });

  test('AC-19 Pattern page, Fetch without JS, Self canonical, title pattern, OG tags, JSON-LD, chart SVG in HTML', async ({ request }) => {
    const response = await request.get('/patterns/lozenge-band');

    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-cache');
    expect(html).toContain('<title>Lozenge Band: free peyote bead pattern | Jinx Bead Patterns</title>');
    expect(html).toContain('<link rel="canonical" href="https://jinx.dloizides.com/patterns/lozenge-band"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('"@type":"HowTo"');
    expect(html).toMatch(/data-testid="pattern-chart"[\s\S]*?<svg/);
    expect(html).toContain('index,follow');
    expect(html).not.toContain('stub-internal-key');
  });

  test('AC-18 Pattern, Read list, counts, Etsy link, disclosure, no affiliate tag', async ({ request }) => {
    const html = await (await request.get('/patterns/lozenge-band')).text();

    const counts = [...html.matchAll(/data-code="DB\w+" data-count="(\d+)"/g)].map((match) => Number(match[1]));

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(12 * 40);
    expect(html).toContain('https://www.etsy.com/search?q=Miyuki+Delica+');
    expect(html).not.toMatch(/etsy\.com\/search[^"]*ref=/);
    expect(html).toContain('data-testid="affiliate-disclosure"');
  });

  test('a removed pattern is a real 410, a missing one 404, a noindex one noindex', async ({ request }) => {
    const gone = await request.get('/patterns/removed-band');

    const missing = await request.get('/patterns/no-such-band');
    const quiet = await (await request.get('/patterns/quiet-strip')).text();
    const unknownRoute = await request.get('/no-such-page');

    expect(gone.status()).toBe(410);
    expect(missing.status()).toBe(404);
    expect(unknownRoute.status()).toBe(404);
    expect(quiet).toContain('noindex,follow');
  });

  test('AC-23 throttled and uncached is 503 with Retry-After, never 404', async ({ request }) => {
    const throttled = await request.get('/patterns/throttled-band');

    expect(throttled.status()).toBe(503);
    expect(throttled.headers()['retry-after']).toBe('60');
  });

  test('AC-23 API down: cached page 200, uncached browse 503 with Retry-After', async ({ request }) => {
    const stub = process.env.JINX_STUB_URL;
    await request.get('/patterns/chevron-run');
    await request.get(`${stub}/__down?on=1`);

    const cached = await request.get('/patterns/chevron-run');
    const uncached = await request.get('/browse?q=never-seen-before');
    await request.get(`${stub}/__down?on=0`);

    expect(cached.status()).toBe(200);
    expect(uncached.status()).toBe(503);
    expect(uncached.headers()['retry-after']).toBe('60');
  });

  test('sitemap, robots and hashed assets follow the standards', async ({ request }) => {
    const index = await (await request.get('/sitemap.xml')).text();

    const patterns = await (await request.get('/sitemap-patterns-1.xml')).text();
    const staticMap = await (await request.get('/sitemap-static.xml')).text();
    const robots = await (await request.get('/robots.txt')).text();
    const home = await request.get('/');
    const homeHtml = await home.text();
    const asset = homeHtml.match(/\/_astro\/[^"']+\.(?:js|css|woff2)/)?.[0] ?? '';
    const assetResponse = await request.get(asset);

    expect(index).toContain('https://jinx.dloizides.com/sitemap-patterns-1.xml');
    expect(patterns).toContain('https://jinx.dloizides.com/patterns/lozenge-band');
    expect(patterns).not.toContain('quiet-strip');
    expect(staticMap).toContain('https://jinx.dloizides.com/guides/finish-a-bracelet');
    expect(robots).toContain('Sitemap: https://jinx.dloizides.com/sitemap.xml');
    expect(home.headers()['cache-control']).toBe('no-cache');
    expect(assetResponse.headers()['cache-control']).toContain('immutable');
    expect(homeHtml).not.toContain('mailto:');
  });

  test('AC-04 AC-12 guides and attribution pages carry their content', async ({ request }) => {
    const guide = await request.get('/guides/finish-earrings');

    const attribution = await (await request.get('/attribution')).text();

    expect(guide.status()).toBe(200);
    expect(await guide.text()).toContain('data-testid="guide-steps"');
    expect(attribution).toContain('MakeBead');
    expect(attribution).toContain('https://creativecommons.org/licenses/by/4.0/');
  });

  test('every API call carries the internal key, none reaches the browser', async ({ request }) => {
    const before = (await (await request.get(`${process.env.JINX_STUB_URL}/__stats`)).json()).withoutKey;
    await request.get('/browse?stitch=loom');

    await request.get('/patterns/tide-strip');

    const stats = await (await request.get(`${process.env.JINX_STUB_URL}/__stats`)).json();
    expect(stats.withKey).toBeGreaterThan(0);
    expect(stats.withoutKey - before).toBe(0);
    expect(stats.withoutKey).toBe(0);
  });

  test('every app link on the site targets a route the app has', async ({ request }) => {
    const routes = appRoutes();
    const links: string[] = [];

    for (const path of APP_LINK_PAGES) {
      const html = await (await request.get(path)).text();
      links.push(...[...html.matchAll(/href="(https:[^"]*jinx-app[^"]*)"/g)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&')));
    }

    const dead = links.filter((link) => !routes.has(new URL(link).pathname));
    const html = await (await request.get('/patterns/lozenge-band')).text();
    expect(routes.has('/tracker')).toBe(true);
    expect(links.length).toBeGreaterThan(0);
    expect(dead).toEqual([]);
    expect(html).toContain(`href="${APP_ORIGIN}/tracker?id=lozenge-band"`);
    expect(html).toContain(`href="${APP_ORIGIN}/recolour?id=lozenge-band"`);
    expect(html).not.toContain('data-testid="report-link"');
    expect(html).not.toContain('>Colour</a>');
  });

  test('one row count: caption, all rows and keep going agree with the woven count', async ({ request }) => {
    const html = await (await request.get('/patterns/lozenge-band')).text();

    expect(html).toContain('Row 1 at the top');
    expect(html).toContain('12 wide, 80 rows');
    expect(html).toContain('All 80 rows');
    expect(html).toContain('to row 80,');
    expect(html).not.toContain('All 79 rows');
  });

  async function walk(page: Page, label: string): Promise<void> {
    await page.goto('/browse');
    await page.getByRole('button', { name: 'Reject all' }).click();
    for (const path of WALK) {
      await page.goto(path, { waitUntil: 'load' });
      await page.evaluate(() => document.querySelectorAll<HTMLImageElement>('img').forEach((image) => { image.loading = 'eager'; }));
      const problems = await page.evaluate((minHit) => {
        const found: string[] = [];
        const root = document.documentElement;
        if (root.scrollWidth > root.clientWidth) found.push(`horizontal scroll ${root.scrollWidth}`);
        const visible = (el: Element): boolean => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        document.querySelectorAll('body *').forEach((el) => {
          const ownText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
          if (!ownText || !visible(el) || el.classList.contains('skip') || el.tagName === 'OPTION' || el.tagName === 'SELECT') return;
          const box = el.getBoundingClientRect();
          const parent = el.parentElement?.getBoundingClientRect();
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') found.push(`overflow ${el.tagName} ${(el.textContent ?? '').slice(0, 30)}`);
          if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).display !== 'inline') found.push(`too tall ${el.tagName} ${el.scrollHeight}>${el.clientHeight}`);
          if (parent !== undefined && box.right > parent.right + 1) found.push(`spills ${el.tagName} ${(el.textContent ?? '').slice(0, 30)}`);
        });
        document.querySelectorAll('a,button,select,input:not([type=hidden]),summary').forEach((el) => {
          if (!visible(el) || el.classList.contains('skip')) return;
          const box = el.getBoundingClientRect();
          if (box.width < minHit || box.height < minHit) found.push(`hit ${el.tagName} ${Math.round(box.width)}x${Math.round(box.height)} ${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}`);
        });
        return found;
      }, MIN_HIT);
      if (SHOT_DIR !== undefined) {
        await page.screenshot({ path: `${SHOT_DIR}/${label}${path.replace(/[^a-z0-9]+/g, '-')}.png`, fullPage: path.includes('lozenge') || path === '/browse' });
      }
      expect(problems, `${label} ${path}`).toEqual([]);
    }
  }

  test.describe('phone 360x640', () => {
    test.use(PHONE);

    test('the pattern chart shows a readable row window with next and previous', async ({ page }) => {
      await page.goto('/patterns/lozenge-band');
      await expect(page.getByTestId('chart-window-label')).toHaveText('Rows 1 to 20 of 80');
      const beadWidth = await page.locator('[data-testid="pattern-chart"] svg rect').first().evaluate((bead) => bead.getBoundingClientRect().width);
      expect(beadWidth).toBeGreaterThanOrEqual(MIN_BEAD_PX);

      await page.getByTestId('chart-next').click();

      await expect(page.getByTestId('chart-window-label')).toHaveText('Rows 21 to 40 of 80');
      await page.getByTestId('chart-previous').click();
      await expect(page.getByTestId('chart-window-label')).toHaveText('Rows 1 to 20 of 80');
      await expect(page.getByTestId('chart-previous')).toBeDisabled();
    });

    test('the chart controls sit above the action bar at the fold', async ({ page }) => {
      await page.goto('/patterns/lozenge-band');

      const next = await page.getByTestId('chart-next').boundingBox();
      const tracker = await page.getByTestId('start-tracker').boundingBox();

      expect((next?.y ?? 0) + (next?.height ?? 0)).toBeLessThanOrEqual(tracker?.y ?? 0);
    });

    test('FORM-ALIGN-1 the side-by-side filters share one top edge and height', async ({ page }) => {
      await page.goto('/browse');

      const stitch = await page.locator('select[name=stitch]').boundingBox();
      const piece = await page.locator('select[name=piece]').boundingBox();

      expect(Math.abs((stitch?.y ?? 0) - (piece?.y ?? 9))).toBeLessThanOrEqual(1);
      expect(Math.abs((stitch?.height ?? 0) - (piece?.height ?? 9))).toBeLessThanOrEqual(1);
    });

    test('the colours come before the word chart', async ({ page }) => {
      await page.goto('/patterns/lozenge-band');

      const colours = await page.getByTestId('colour-key').boundingBox();
      const words = await page.getByTestId('word-chart').boundingBox();

      expect(colours?.y ?? 0).toBeLessThan(words?.y ?? 0);
    });

    test('every screen fits with hit boxes of 44 or more', async ({ page }) => {
      await walk(page, 'phone');
    });
  });

  test.describe('desktop 1280x800', () => {
    test.use(DESKTOP);

    test('every screen fits with hit boxes of 44 or more', async ({ page }) => {
      await walk(page, 'desktop');
    });

    test('FOCUS-1 the pattern page focuses Start row tracker', async ({ page }) => {
      await page.goto('/patterns/lozenge-band');

      await expect(page.getByTestId('start-tracker')).toBeFocused();
    });

    test('pick B: the word chart comes before the colours', async ({ page }) => {
      await page.goto('/patterns/lozenge-band');

      const colours = await page.getByTestId('colour-key').boundingBox();
      const words = await page.getByTestId('word-chart').boundingBox();

      expect(words?.y ?? 0).toBeLessThan(colours?.y ?? 0);
    });

    test('FOCUS-1 rejecting consent leaves focus on the named control', async ({ page }) => {
      await page.goto('/patterns/lozenge-band');

      await page.getByRole('button', { name: 'Reject all' }).click();

      await expect(page.getByTestId('start-tracker')).toBeFocused();
    });

    test('FOCUS-1 the empty browse focuses Clear all filters', async ({ page }) => {
      await page.goto('/browse?q=zzzznothing');

      await expect(page.getByTestId('clear-filters')).toBeFocused();
    });
  });
});

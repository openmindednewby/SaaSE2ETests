import { expectTextFits } from '@dloizides/game-e2e';
import { expect, test, type Page } from '@playwright/test';

const WEB = process.env.KEFI_WEB_URL ?? 'https://app.kefi.dloizides.com';
const VIEWPORTS = [
  { name: 'phone', width: 360, height: 640 },
  { name: 'desktop', width: 1280, height: 800 },
];
const MIN_CONTRAST = 4.5;
const HERO_TEXT = ['.hero .hero-edition', '.hero .hero-styles'];
const HERO_CTA = '.hero .hero-cta .btn-primary';

interface HeroLook {
  backgroundImage: string;
  fontFamily: string;
  bodyBg: string;
}

async function heroLook(page: Page, slug: string): Promise<HeroLook> {
  await page.goto(`${WEB}/t/${slug}/`, { waitUntil: 'networkidle' });
  return page.locator('.hero').evaluate(hero => {
    const style = getComputedStyle(hero);
    return {
      backgroundImage: style.backgroundImage,
      fontFamily: style.fontFamily,
      bodyBg: getComputedStyle(document.documentElement).getPropertyValue('--body-bg').trim(),
    };
  });
}

async function ctaContrast(page: Page): Promise<number> {
  return page.locator(HERO_CTA).first().evaluate(el => {
    const rgb = (c: string): number[] => (c.match(/[\d.]+/g) ?? ['0', '0', '0', '0']).map(Number);
    const lum = (c: number[]): number => {
      const [r, g, b] = c.slice(0, 3).map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let node: Element | null = el;
    let bg = rgb(getComputedStyle(el).backgroundColor);
    while (node !== null && bg.length > 3 && bg[3] === 0) {
      node = node.parentElement;
      bg = node === null ? [255, 255, 255] : rgb(getComputedStyle(node).backgroundColor);
    }
    const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`demo hero at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('demo hero matches the KUCY hero', async ({ page }) => {
      const kucy = await heroLook(page, 'kucy');

      const demo = await heroLook(page, 'demo');

      expect(demo).toEqual(kucy);
    });

    test('demo hero fits, no horizontal scroll, CTA contrast >= 4.5:1', async ({ page }) => {
      await page.goto(`${WEB}/t/demo/`, { waitUntil: 'networkidle' });

      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));

      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
      for (const selector of [...HERO_TEXT, HERO_CTA]) await expectTextFits(page, selector);
      expect(await ctaContrast(page)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  });
}

import fs from 'fs';
import { test } from '@playwright/test';
const OUT = 'C:/Users/loizi/AppData/Local/Temp/claude/7561e94a61cf24d8/b1b48af7-c651-4776-85dc-ee03c03e30ab/scratchpad/sight-fsh';
for (const vp of [{ width: 360, height: 640 }, { width: 1280, height: 800 }]) {
  test(`fsh ${vp.width}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await page.goto('https://nextgame.dloizides.com/consent', { waitUntil: 'networkidle' });
    const year = page.getByRole('textbox', { name: 'Birth year' });
    if (await year.isVisible()) {
      await year.fill('1990');
      await page.getByRole('button', { name: 'Continue' }).click();
    }
    await page.waitForSelector('[role=switch]', { timeout: 30000 });
    const res = await page.evaluate(() => [...document.querySelectorAll('[role=switch]')].map((el) => {
      const r = el.getBoundingClientRect();
      const drawn = (el.parentElement as HTMLElement).getBoundingClientRect();
      return { tag: el.tagName, input: [Math.round(r.width), Math.round(r.height)], drawn: [Math.round(drawn.width), Math.round(drawn.height)], centred: Math.abs((r.x + r.width / 2) - (drawn.x + drawn.width / 2)) < 1 && Math.abs((r.y + r.height / 2) - (drawn.y + drawn.height / 2)) < 1 };
    }));
    await page.screenshot({ path: `${OUT}/consent-${vp.width}.png` });
    fs.writeFileSync(`${OUT}/fsh-${vp.width}.json`, JSON.stringify(res));
    await ctx.close();
  });
}

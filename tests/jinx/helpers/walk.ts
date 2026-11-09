import { expect, type Page } from '@playwright/test';

const WALK = ['/', '/browse', '/browse?q=zzzznothing', '/patterns/lozenge-band', '/patterns/removed-band', '/guides', '/guides/finish-a-bracelet', '/attribution', '/privacy', '/no-such-page'];
const MIN_HIT = 44;
const SHOT_DIR = process.env.JINX_SHOT_DIR;
const TAPPABLE = 'a,button,select,input:not([type=hidden]),summary';

async function readProblems(page: Page): Promise<string[]> {
  return page.evaluate(({ minHit, tappable }) => {
    const found: string[] = [];
    const root = document.documentElement;
    const label = (el: Element): string => (el.textContent ?? '').slice(0, 30);
    const visible = (el: Element): boolean => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const boxParent = (el: Element): Element | null => {
      let up = el.parentElement;
      while (up !== null && getComputedStyle(up).display === 'contents') up = up.parentElement;
      return up;
    };
    if (root.scrollWidth > root.clientWidth) found.push(`horizontal scroll ${root.scrollWidth}`);
    document.querySelectorAll('body *').forEach((el) => {
      const ownText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
      if (!ownText || !visible(el) || el.classList.contains('skip') || el.tagName === 'OPTION' || el.tagName === 'SELECT') return;
      const blockLevel = getComputedStyle(el).display !== 'inline';
      if (el.scrollWidth > el.clientWidth + 1 && blockLevel) found.push(`overflow ${el.tagName} ${label(el)}`);
      if (el.scrollHeight > el.clientHeight + 1 && blockLevel) found.push(`too tall ${el.tagName} ${el.scrollHeight}>${el.clientHeight}`);
      const holder = boxParent(el);
      if (holder === null || ['auto', 'scroll'].includes(getComputedStyle(holder).overflowX)) return;
      if (el.getBoundingClientRect().right > holder.getBoundingClientRect().right + 1) found.push(`spills ${el.tagName} ${label(el)}`);
    });
    document.querySelectorAll(tappable).forEach((el) => {
      if (!visible(el) || el.classList.contains('skip')) return;
      const box = el.getBoundingClientRect();
      if (box.width >= minHit && box.height >= minHit) return;
      found.push(`hit ${el.tagName} ${Math.round(box.width)}x${Math.round(box.height)} ${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}`);
    });
    return found;
  }, { minHit: MIN_HIT, tappable: TAPPABLE });
}

export async function walk(page: Page, label: string): Promise<void> {
  await page.goto('/browse');
  await page.getByRole('button', { name: 'Reject all' }).click();
  for (const path of WALK) {
    await page.goto(path, { waitUntil: 'load' });
    await page.evaluate(() => document.querySelectorAll<HTMLImageElement>('img').forEach((image) => { image.loading = 'eager'; }));
    const problems = await readProblems(page);
    if (SHOT_DIR !== undefined) {
      await page.screenshot({ path: `${SHOT_DIR}/${label}${path.replace(/[^a-z0-9]+/g, '-')}.png`, fullPage: path.includes('lozenge') || path === '/browse' });
    }
    expect(problems, `${label} ${path}`).toEqual([]);
  }
}

import type { Page } from '@playwright/test';

export interface DarkProbe {
  readonly url: string;
  readonly bodyBg: string;
  readonly rootBg: string;
  readonly scheme: boolean;
  readonly scrollW: number;
  readonly vw: number;
  readonly light: readonly string[];
  readonly lowC: readonly string[];
  readonly consoleErrors: readonly string[];
}

const LIMITS = { textMin: 4.5, largeTextMin: 3, lightLuminance: 0.5, minPanelArea: 2000 } as const;

export async function probeDark(page: Page, consoleErrors: readonly string[]): Promise<DarkProbe> {
  const result = await page.evaluate((lim) => {
    const rgba = (c: string): number[] => {
      const v = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c === 'transparent' || v.length < 3 ? [0, 0, 0, 0] : [v[0], v[1], v[2], v[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]): number => {
      const ch = (x: number): number => { const c = x / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (a: number[], b: number[]): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const swatch = document.createElement('div');
    swatch.style.background = 'Canvas';
    document.body.appendChild(swatch);
    const canvas = rgba(getComputedStyle(swatch).backgroundColor);
    swatch.remove();
    const hidden = (el: Element): boolean => {
      for (let n: Element | null = el; n !== null; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return true;
        if (n.getAttribute('aria-hidden') === 'true') return true;
      }
      return false;
    };
    const paint = (el: Element): { fill: number[]; owner: Element | null; image: boolean } => {
      const layers: number[][] = [];
      let owner: Element | null = null;
      let image = false;
      for (let n: Element | null = el; n !== null; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.backgroundImage !== 'none') image = true;
        const layer = rgba(s.backgroundColor);
        if (layer[3] > 0 && owner === null) owner = n;
        if (layer[3] > 0) layers.push(layer);
        if (layer[3] >= 1) break;
      }
      const base = layers.length > 0 && layers[layers.length - 1][3] >= 1 ? (layers.pop() as number[]) : canvas;
      const fill = layers.reverse().reduce((u, [r, g, b, a]) => [r * a + u[0] * (1 - a), g * a + u[1] * (1 - a), b * a + u[2] * (1 - a), 1], base);
      return { fill: fill.map(Math.round), owner, image };
    };
    const tag = (el: Element, r: DOMRect): string => `${el.getAttribute('data-testid') ?? el.tagName}@${Math.round(r.left)},${Math.round(r.top)}`;
    const css = (c: number[]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    const lowC: string[] = [];
    const light: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || hidden(el)) continue;
      const s = getComputedStyle(el);
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim();
      if (own !== '') {
        const { fill, image } = paint(el);
        const size = parseFloat(s.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
        const value = ratio(rgba(s.color), fill);
        if (value < (large ? lim.largeTextMin : lim.textMin)) lowC.push(`${tag(el, r)} "${own.slice(0, 30)}" ${s.color} on ${css(fill)} ${value}${image ? ' (bg-image)' : ''}`);
      }
      const bg = rgba(s.backgroundColor);
      if (bg[3] >= 1 && lum(bg) > lim.lightLuminance && r.width * r.height >= lim.minPanelArea) {
        const inView = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const top = inView ? document.elementFromPoint(cx, cy) : null;
        const shows = top !== null && paint(top).owner === el;
        if (shows || !inView) light.push(`${tag(el, r)} ${s.backgroundColor} ${Math.round(r.width)}x${Math.round(r.height)}${inView ? '' : ' (offscreen)'}`);
      }
    }
    return {
      url: location.href,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      rootBg: getComputedStyle(document.getElementById('root') ?? document.body).backgroundColor,
      scheme: matchMedia('(prefers-color-scheme: dark)').matches,
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
      light,
      lowC,
    };
  }, LIMITS);
  return { ...result, consoleErrors };
}

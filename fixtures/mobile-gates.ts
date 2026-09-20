import { devices, expect, type Page } from '@playwright/test';

/**
 * The two mobile assertions the estate kept getting WRONG, in one place.
 *
 * Both of the "obvious" probes are broken, and both shipped a green-but-blind
 * report on 2026-09-20 (MOBILE-STD-1 "mobile gates and the shared breakpoint
 * module", AC-3):
 *
 *  - Horizontal overflow compared against `window.innerWidth`. When a
 *    transition layer widens the LAYOUT viewport (360 -> 385) the page really
 *    does scroll sideways, but `innerWidth` widens WITH it, so the check reads
 *    `385 === 385` and passes on the exact defect. `window.visualViewport.width`
 *    stays at what the device actually shows, so it is the only honest
 *    denominator. The defect also does not exist on first paint - it appears
 *    after the visitor taps - so the reading has to be taken AFTER navigating
 *    too, never only on load.
 *  - Touch targets selected by `[tabindex]` OVER-count (six `<h2 tabindex="-1">`
 *    headings were reported as controls and had to be retracted); selected by
 *    ARIA role alone they UNDER-count (130 unlabelled 28x44 targets on
 *    /profile were invisible to a role-only probe, which found one control and
 *    called the screen clean). The union of role AND press-handler is the
 *    probe; a pressable with neither a role nor an accessible name is counted
 *    as a DEFECT of its own rather than dropped from the tally.
 */

/** WCAG 2.5.5 / platform minimum, in CSS px. */
export const MIN_TARGET_PX = 44;

/**
 * Device DESCRIPTORS, never bare viewports. A `viewport: {width, height}` alone
 * leaves `isMobile` false, the device-scale-factor at 1, `hasTouch` off and a
 * DESKTOP user-agent, so the page is rendered by a desktop engine that happens
 * to be narrow: `<meta name="viewport">` is not honoured, the visual viewport is
 * not emulated, and a layout that only breaks under real mobile viewport
 * semantics is papered over instead of reproduced.
 *
 * The heights below are the descriptors' own values, read from the installed
 * Playwright rather than from a spec sheet - a descriptor height is the USABLE
 * viewport with browser chrome already subtracted, so Pixel 5 is 393x727 and
 * not the 393x851 physical screen.
 */
/** The floor every surface must survive: 360x640. */
export const MOBILE_FLOOR = devices['Galaxy S5'];
/** The representative modern phone: 393x727 (screen 393x851). */
export const MOBILE_REPRESENTATIVE = devices['Pixel 5'];

export interface OverflowReading {
  scrollWidth: number;
  visualViewportWidth: number;
  innerWidth: number;
  clientWidth: number;
  overflowPx: number;
  /** innerWidth drifting above visualViewport IS the signature of the layout-viewport defect. */
  layoutViewportDrift: number;
}

export async function readHorizontalOverflow(page: Page): Promise<OverflowReading> {
  return page.evaluate(() => {
    const vvWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    return {
      scrollWidth,
      visualViewportWidth: vvWidth,
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowPx: scrollWidth - Math.ceil(vvWidth),
      layoutViewportDrift: window.innerWidth - Math.ceil(vvWidth),
    };
  });
}

/** Fails when the document scrolls wider than the viewport the DEVICE actually shows. */
export async function expectNoHorizontalOverflow(page: Page, where: string): Promise<OverflowReading> {
  const r = await readHorizontalOverflow(page);
  expect(
    r.overflowPx,
    `${where}: scrolls horizontally - scrollWidth=${String(r.scrollWidth)} vs visualViewport=${String(Math.ceil(r.visualViewportWidth))} `
      + `(innerWidth=${String(r.innerWidth)}, clientWidth=${String(r.clientWidth)}, layout-viewport drift=${String(r.layoutViewportDrift)}px)`,
  ).toBeLessThanOrEqual(0);
  return r;
}

export interface TargetFinding {
  selector: string;
  width: number;
  height: number;
  reason: string;
  name: string;
}

export interface TargetAudit {
  total: number;
  undersized: TargetFinding[];
  unlabelled: TargetFinding[];
}

/**
 * Union probe: ARIA/native role OR a press handler. `tabindex` counts only at
 * >= 0 (a `tabindex="-1"` heading is a scroll anchor, not a control), and a
 * `cursor: pointer` element that CONTAINS another candidate is a container
 * rather than the target.
 */
export async function auditTouchTargets(page: Page, minPx = MIN_TARGET_PX): Promise<TargetAudit> {
  return page.evaluate((min) => {
    const ROLE_SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary,'
      + ' [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"],'
      + ' [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="slider"]';
    const why = (el: Element): string | null => {
      if (el.matches(ROLE_SEL)) return 'role';
      if (typeof (el as HTMLElement).onclick === 'function') return 'handler';
      const ti = el.getAttribute('tabindex');
      if (ti !== null && Number(ti) >= 0) return 'tabindex';
      const cs = getComputedStyle(el);
      if (cs.cursor === 'pointer' && cs.pointerEvents !== 'none') return 'cursor';
      return null;
    };
    const raw = Array.from(document.querySelectorAll('*'))
      .map((el) => ({ el, reason: why(el) }))
      .filter((c): c is { el: Element; reason: string } => c.reason !== null);
    const members = new Set(raw.map((c) => c.el));
    const kept = raw.filter(({ el, reason }) => {
      // A cursor-only wrapper around real controls is chrome, not a tap target.
      if (reason === 'cursor' && Array.from(el.querySelectorAll('*')).some((d) => members.has(d))) return false;
      // Drop a candidate that merely duplicates an ancestor candidate's box.
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (!members.has(p)) continue;
        const pr = p.getBoundingClientRect();
        if (Math.abs(pr.width - r.width) <= 1 && Math.abs(pr.height - r.height) <= 1) return false;
      }
      return true;
    });
    const describe = (el: Element): string => {
      const id = el.getAttribute('data-testid') ?? el.getAttribute('id') ?? '';
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}`.slice(0, 60);
    };
    const accName = (el: Element): string => {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by.split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? '').join(' ').trim();
        if (t) return t;
      }
      const attr = el.getAttribute('title') ?? el.getAttribute('alt') ?? (el as HTMLInputElement).value ?? '';
      if (attr && attr.trim()) return attr.trim();
      return (el.textContent ?? '').trim();
    };
    const undersized: unknown[] = [];
    const unlabelled: unknown[] = [];
    let total = 0;
    for (const { el, reason } of kept) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      total += 1;
      const f = {
        selector: describe(el),
        width: Math.round(r.width),
        height: Math.round(r.height),
        reason,
        name: accName(el).slice(0, 40),
      };
      if (r.width < min || r.height < min) undersized.push(f);
      const hasRole = el.matches(ROLE_SEL) || (el.getAttribute('role') ?? '') !== '';
      if (!hasRole && !f.name) unlabelled.push(f);
    }
    return { total, undersized, unlabelled } as unknown as TargetAudit;
  }, minPx);
}

const MAX_REPORTED = 12;

function render(findings: TargetFinding[]): string {
  const shown = findings.slice(0, MAX_REPORTED)
    .map((f) => `${f.selector} ${String(f.width)}x${String(f.height)} via=${f.reason} name="${f.name}"`);
  const rest = findings.length - shown.length;
  return shown.join('; ') + (rest > 0 ? ` (+${String(rest)} more)` : '');
}

/** Fails on any visible pressable under 44px, and on any pressable with neither role nor name. */
export async function expectTouchTargets(page: Page, where: string, minPx = MIN_TARGET_PX): Promise<TargetAudit> {
  const audit = await auditTouchTargets(page, minPx);
  expect(audit.total, `${where}: probe found NO interactive targets - the probe is broken, not the page`).toBeGreaterThan(0);
  expect(
    audit.undersized.length,
    `${where}: ${String(audit.undersized.length)} of ${String(audit.total)} targets under ${String(minPx)}px -> ${render(audit.undersized)}`,
  ).toBe(0);
  expect(
    audit.unlabelled.length,
    `${where}: ${String(audit.unlabelled.length)} pressables with NO role and NO accessible name -> ${render(audit.unlabelled)}`,
  ).toBe(0);
  return audit;
}

/** Public, signed-out-reachable routes per portal. Keyed by the mobile project's portal slug. */
export const PORTAL_ROUTES: Record<string, string[]> = {
  nextgame: ['/', '/age', '/privacy'],
  katalogos: ['/'],
  erevna: ['/'],
  kefi: ['/'],
  ichnos: ['/'],
  agora: ['/'],
  zygos: ['/'],
  poueni: ['/'],
  'digital-kin': ['/'],
};

/** `mobile-gates-<portal>-<device>` -> `<portal>`. */
export function portalFromProjectName(projectName: string): string {
  return projectName.replace(/^mobile-gates-/, '').replace(/-(floor|pixel5)$/, '');
}

import { expect, type Page } from '@playwright/test';

export { MOBILE_FLOOR, MOBILE_REPRESENTATIVE } from './mobile-devices.js';
export * from './mobile-overflow.js';
export { PORTAL_ROUTES, portalFromProjectName } from './mobile-portal-routes.js';

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
 *
 * MOBILE-STD-1 follow-up, 2026-09-20: `expectTouchTargets` used to make the two
 * touch-target claims as TWO separate `expect`s. `expect` throws, so the second
 * one never executed on any of the 8 portals - and it was unreachable precisely
 * when the first had findings, which is exactly when it is worth reading. Its
 * only evidence was a synthetic negative control. Both sets are now collected
 * and reported through ONE assertion, so a run can never again answer one
 * question and silently drop the other.
 */

/** WCAG 2.5.5 / platform minimum, in CSS px. */
export const MIN_TARGET_PX = 44;


export interface TargetFinding {
  /** Index within the audited set, so host-side code can tell whether one element is in BOTH lists. */
  idx: number;
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
  /**
   * Funnel counts, so a ZERO is always attributable. "The probe reported
   * nothing" and "the probe narrowed until it reports nothing" look identical
   * from a tally; `raw -> afterWrapper -> kept -> total` says which one it was.
   */
  probe: { raw: number; afterWrapper: number; kept: number };
}

/**
 * The probe, third revision (2026-09-21). Two OPPOSITE failures have now been
 * made, one after the other, and this definition is the line between them.
 *
 *  - ROLE-ONLY under-counts: 130 unlabelled 28x44 targets on /profile were
 *    invisible to it; it found ONE control there and called the screen clean.
 *  - CURSOR-AS-HANDLER over-counts, badly. `cursor` INHERITS, so every
 *    descendant of a `<button>` inherited `pointer` and was counted as its own
 *    tap target. On nextgame `/` that read 50 targets / 21 undersized / 35
 *    unlabelled where a strict re-measure and Playwright's own ARIA snapshot
 *    both say SIX named controls: 84 of the extras sat inside an `aria-hidden`
 *    decorative backdrop, and the rest were 0x0 SVG `<stop>`/`<defs>` and
 *    `<path>` nodes inside an already-labelled control.
 *
 * What is settled, and why:
 *  - `cursor: pointer` is evidence ONLY where the element is where it STARTS -
 *    its parent's computed cursor is something else. That is the closest a
 *    DOM-side probe gets to "this node, not its text span, is the pressable",
 *    because React attaches listeners at the root and the `onclick` PROPERTY is
 *    genuinely absent on a React handler. An INHERITED `pointer` is now
 *    evidence of nothing.
 *  - OUTERMOST wins: a candidate that sits inside another kept candidate is
 *    dropped, so one control is counted once, at its own box.
 *  - ...except a NON-role wrapper around a role candidate, which is chrome and
 *    is dropped in favour of the real control inside it.
 *  - `aria-hidden="true"` subtrees, `[inert]`, `pointer-events: none` (which
 *    inherits, so the computed value already covers the subtree) and disabled
 *    controls are excluded outright - a finger cannot reach them.
 *  - SVG nodes count only with an explicit `role`; `<path>`/`<stop>`/`<defs>`
 *    are paint, not controls.
 *
 * The D10 case survives all of that: a genuinely pressable element with no role
 * and no accessible name still registers (handler, tabindex, or an own-origin
 * pointer cursor) and is reported as a DEFECT rather than dropped from the tally.
 */
export async function auditTouchTargets(page: Page, minPx = MIN_TARGET_PX): Promise<TargetAudit> {
  return page.evaluate((min) => {
    const ROLE_SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary,'
      + ' [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"],'
      + ' [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="slider"]';
    const unreachable = (el: Element, cs: CSSStyleDeclaration): boolean => {
      if (el.closest('[aria-hidden="true"]')) return true;
      if (el.closest('[inert]')) return true;
      if (cs.pointerEvents === 'none') return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if ((el as HTMLButtonElement).disabled === true) return true;
      return false;
    };
    const why = (el: Element, cs: CSSStyleDeclaration): string | null => {
      if (el instanceof SVGElement && !el.hasAttribute('role')) return null;
      if (el.matches(ROLE_SEL)) return 'role';
      if (typeof (el as HTMLElement).onclick === 'function') return 'handler';
      if (el.getAttribute('data-focusable') === 'true') return 'rnw-focusable';
      const ti = el.getAttribute('tabindex');
      if (ti !== null && Number(ti) >= 0) return 'tabindex';
      // OWN-ORIGIN pointer cursor only. An inherited `pointer` is what produced
      // the 50-vs-6 over-count and is deliberately no longer evidence.
      if (cs.cursor === 'pointer') {
        const parent = el.parentElement;
        if (!parent || getComputedStyle(parent).cursor !== 'pointer') return 'cursor-origin';
      }
      return null;
    };
    const raw: { el: Element; reason: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if (unreachable(el, cs)) continue;
      const reason = why(el, cs);
      if (reason !== null) raw.push({ el, reason });
    }
    const members = new Set(raw.map((c) => c.el));
    // A non-role wrapper around a real control is chrome, not a tap target.
    const afterWrapper = raw.filter(({ el, reason }) => {
      if (reason === 'role') return true;
      return !Array.from(el.querySelectorAll(ROLE_SEL)).some((d) => members.has(d));
    });
    const survivors = new Set(afterWrapper.map((c) => c.el));
    // OUTERMOST wins: drop any candidate nested inside another surviving candidate.
    const kept = afterWrapper.filter(({ el }) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (survivors.has(p)) return false;
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
      const f = {
        idx: total,
        selector: describe(el),
        width: Math.round(r.width),
        height: Math.round(r.height),
        reason,
        name: accName(el).slice(0, 40),
      };
      total += 1;
      if (r.width < min || r.height < min) undersized.push(f);
      const hasRole = el.matches(ROLE_SEL) || (el.getAttribute('role') ?? '') !== '';
      if (!hasRole && !f.name) unlabelled.push(f);
    }
    const probe = { raw: raw.length, afterWrapper: afterWrapper.length, kept: kept.length };
    return { total, undersized, unlabelled, probe } as unknown as TargetAudit;
  }, minPx);
}

const MAX_REPORTED = 12;

function render(findings: TargetFinding[], alsoIn: Set<number>, alsoLabel: string): string {
  if (findings.length === 0) return 'none';
  const shown = findings.slice(0, MAX_REPORTED)
    .map((f) => `${f.selector} ${String(f.width)}x${String(f.height)} via=${f.reason} name="${f.name}"`
      + (alsoIn.has(f.idx) ? ` [ALSO ${alsoLabel}]` : ''));
  const rest = findings.length - shown.length;
  return shown.join('; ') + (rest > 0 ? ` (+${String(rest)} more)` : '');
}

/** One route's reading. `total === 0` is a BROKEN PROBE for THAT route, never a clean route. */
export interface RouteAudit {
  route: string;
  audit: TargetAudit;
}

/**
 * Measures one route and asserts NOTHING, so a route with findings cannot hide
 * the routes after it. The caller collects these and asserts once per portal.
 */
export async function auditRoute(page: Page, route: string, minPx = MIN_TARGET_PX): Promise<RouteAudit> {
  return { route, audit: await auditTouchTargets(page, minPx) };
}

/** The zero-target precondition is evaluated PER ROUTE and rendered PER ROUTE. */
function renderRoute({ route, audit }: RouteAudit, minPx: number): string {
  if (audit.total === 0) {
    return `\n  ${route}: PROBE FOUND NO INTERACTIVE TARGETS - the probe is broken, or the route loaded blank.`
      + ' NOT a clean route.'
      + ` [funnel: raw=${String(audit.probe.raw)} -> afterWrapper=${String(audit.probe.afterWrapper)}`
      + ` -> outermost=${String(audit.probe.kept)}]`;
  }
  const undersizedIdx = new Set(audit.undersized.map((f) => f.idx));
  const unlabelledIdx = new Set(audit.unlabelled.map((f) => f.idx));
  const both = audit.unlabelled.filter((f) => undersizedIdx.has(f.idx)).length;
  return `\n  ${route}: ${String(audit.undersized.length)} of ${String(audit.total)} under ${String(minPx)}px`
    + `; ${String(audit.unlabelled.length)} of ${String(audit.total)} with NO role and NO accessible name`
    + `; ${String(both)} BOTH`
    + `\n    UNDERSIZED (<${String(minPx)}px): ${render(audit.undersized, unlabelledIdx, 'unlabelled')}`
    + `\n    UNLABELLED (no role, no name): ${render(audit.unlabelled, undersizedIdx, 'undersized')}`;
}

function routeProblems({ audit }: RouteAudit): number {
  if (audit.total === 0) return 1;
  return audit.undersized.length + audit.unlabelled.length;
}

/**
 * ONE assertion per PORTAL, covering every route and both claims.
 *
 * Three ways this gate used to stop early, each hiding exactly what it was built
 * to find, and each unreachable precisely when there were findings:
 *  - two `expect`s per route -> the unlabelled claim never ran once the size
 *    claim had findings (8 portals, never observed);
 *  - one `expect` per route -> every route after the first with findings was
 *    never measured (nextgame `/age` and `/privacy`, never observed);
 *  - a hard `total > 0` precondition -> one blank route aborted the portal.
 * So: measure every route, then fail once. `expect.soft` was rejected - it emits
 * one error per route per claim, which buries the portal tally the gate exists to
 * produce, and leaves a passing-looking return in the caller's hands. The zero-
 * target precondition still fires PER ROUTE: a blank route counts as a problem of
 * its own and is named in the breakdown, so it cannot hide inside a portal whose
 * other routes loaded.
 */
export function expectTouchTargetsAcrossRoutes(readings: RouteAudit[], portal: string, minPx = MIN_TARGET_PX): void {
  expect(readings.length, `${portal}: no routes were measured at all`).toBeGreaterThan(0);
  const sum = (pick: (r: RouteAudit) => number): number => readings.reduce((n, r) => n + pick(r), 0);
  const blank = readings.filter((r) => r.audit.total === 0).length;
  expect(
    sum(routeProblems),
    `${portal}: ${String(readings.length)} route(s), ${String(sum((r) => r.audit.total))} targets`
      + `; ${String(sum((r) => r.audit.undersized.length))} under ${String(minPx)}px`
      + `; ${String(sum((r) => r.audit.unlabelled.length))} with NO role and NO accessible name`
      + `; ${String(blank)} route(s) read ZERO targets`
      + readings.map((r) => renderRoute(r, minPx)).join(''),
  ).toBe(0);
}

/** Single-route convenience over the per-portal assertion above. */
export async function expectTouchTargets(page: Page, where: string, minPx = MIN_TARGET_PX): Promise<TargetAudit> {
  const reading = await auditRoute(page, where, minPx);
  expectTouchTargetsAcrossRoutes([reading], where, minPx);
  return reading.audit;
}

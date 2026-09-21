import { expect, type Page } from '@playwright/test';

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

/** One route's overflow reading. Measures and asserts NOTHING. */
export interface RouteOverflow {
  route: string;
  reading: OverflowReading;
}

/**
 * Measures one route and asserts NOTHING, so the first overflowing route cannot
 * hide every route after it. Same shape as `auditRoute` below - one idiom, not two.
 */
export async function measureHorizontalOverflow(page: Page, route: string): Promise<RouteOverflow> {
  return { route, reading: await readHorizontalOverflow(page) };
}

function renderOverflow({ route, reading: r }: RouteOverflow): string {
  const head = r.overflowPx > 0 ? `OVERFLOWS by ${String(r.overflowPx)}px` : 'ok';
  return `\n  ${route}: ${head} - scrollWidth=${String(r.scrollWidth)}`
    + ` vs visualViewport=${String(Math.ceil(r.visualViewportWidth))}`
    + ` (innerWidth=${String(r.innerWidth)}, clientWidth=${String(r.clientWidth)}`
    + `, layout-viewport drift=${String(r.layoutViewportDrift)}px)`;
}

/**
 * ONE assertion per PORTAL, covering every route.
 *
 * `expectNoHorizontalOverflow` used to be called INSIDE the caller's route loop,
 * and it throws, so it reported the FIRST overflowing route and hid every route
 * after it - the same early-exit shape `expectTouchTargetsAcrossRoutes` was
 * rewritten to remove. `expect.soft` was rejected for the reason it was rejected
 * there: one error per route buries the portal tally the gate exists to produce.
 *
 * The denominator stays `window.visualViewport.width`, never `innerWidth`: a
 * full-width transition layer widens the LAYOUT viewport along with the
 * document, so `innerWidth` reads 385 === 385 and passes on the exact defect.
 * `layoutViewportDrift` is printed per route because that drift IS the signature.
 */
export function expectNoHorizontalOverflowAcrossRoutes(readings: RouteOverflow[], portal: string): void {
  expect(readings.length, `${portal}: no routes were measured at all`).toBeGreaterThan(0);
  const bad = readings.filter((r) => r.reading.overflowPx > 0);
  const worst = readings.reduce((n, r) => Math.max(n, r.reading.overflowPx), 0);
  expect(
    bad.length,
    `${portal}: ${String(readings.length)} reading(s), ${String(bad.length)} scroll horizontally`
      + `; worst overflow ${String(worst)}px`
      + readings.map(renderOverflow).join(''),
  ).toBe(0);
}

/** Single-route convenience over the per-portal assertion above. */
export async function expectNoHorizontalOverflow(page: Page, where: string): Promise<OverflowReading> {
  const r = await measureHorizontalOverflow(page, where);
  expectNoHorizontalOverflowAcrossRoutes([r], where);
  return r.reading;
}

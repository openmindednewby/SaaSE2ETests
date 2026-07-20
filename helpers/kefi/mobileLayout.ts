/**
 * Phone-viewport layout assertions — the checks that only a browser can make.
 *
 * Every unit test and every `@api` spec in this suite can pass while an attendee
 * on a phone cannot complete a purchase, because the defect is geometric: a
 * button rendered 40px past the right edge of a 393px screen is present in the
 * DOM, visible to `toBeVisible()`, clickable by Playwright (which scrolls to it
 * first), and completely unreachable for a human who does not think to swipe
 * sideways on a page that gives no hint it scrolls.
 *
 * Most UBB attendees will buy on a phone. So these helpers assert two distinct
 * properties that are easy to conflate:
 *
 *   1. {@link expectNoHorizontalOverflow} — the PAGE does not scroll sideways.
 *      Reported with the offending elements named, because "scrollWidth 431 >
 *      innerWidth 393" tells you nothing about which element to fix.
 *   2. {@link expectWithinViewportWidth} — a SPECIFIC element (the pay button,
 *      the QR) sits entirely inside the viewport's horizontal bounds.
 *
 * (1) can pass while (2) fails, when an element is clipped by an
 * `overflow:hidden` ancestor: the page does not scroll, and the button is
 * genuinely unreachable — the worst case, and the one a page-level check alone
 * would miss entirely.
 */

import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Sub-pixel tolerance. Browsers compute fractional layout widths, and a
 * scrollWidth exceeding innerWidth by less than a pixel is a rounding artefact,
 * not a scrollbar a human could ever trigger.
 */
const SUBPIXEL_TOLERANCE_PX = 1;

/** How many offending elements to name before truncating the failure message. */
const MAX_REPORTED_OFFENDERS = 8;

/** One element that sticks out past the viewport's right edge. */
interface OverflowOffender {
  selector: string;
  right: number;
  width: number;
}

/**
 * Assert the page does not scroll horizontally, naming the elements responsible.
 *
 * The offender scan runs in the page: it walks every element, keeps those whose
 * right edge passes the viewport, and drops any whose parent ALSO overflows —
 * so the report names the outermost element actually causing the overflow
 * rather than the fifty descendants dragged along with it.
 */
export async function expectNoHorizontalOverflow(page: Page, surface: string): Promise<void> {
  const result = await page.evaluate((maxOffenders: number) => {
    const innerWidth = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;

    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof el.className === 'string' && el.className.trim().length > 0
          ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
          : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };

    const overflowing: Element[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect();
      // Zero-area nodes cannot be what a user sees sticking out.
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > innerWidth + 1) overflowing.push(el);
    }

    const offenders = overflowing
      .filter((el) => !(el.parentElement !== null && overflowing.includes(el.parentElement)))
      .slice(0, maxOffenders)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          selector: describe(el),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });

    return { innerWidth, scrollWidth, offenders };
  }, MAX_REPORTED_OFFENDERS);

  const overflowPx = result.scrollWidth - result.innerWidth;
  const detail =
    result.offenders.length === 0
      ? '(no single element identified — suspect a fixed width or a negative margin on a wrapper)'
      : (result.offenders as OverflowOffender[])
          .map((o) => `      • ${o.selector} — ${o.width}px wide, right edge at ${o.right}px`)
          .join('\n');

  expect(
    overflowPx,
    `${surface} scrolls sideways on a phone: the document is ${result.scrollWidth}px wide in a ` +
      `${result.innerWidth}px viewport (${overflowPx}px of overflow). An attendee has to swipe ` +
      `horizontally to see the full page, with no visual cue that they should.\n` +
      `    Widest offending elements:\n${detail}\n`,
  ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX);
}

/**
 * Assert one element sits entirely within the viewport's horizontal bounds.
 *
 * Deliberately does NOT scroll the element into view first: scrolling is what
 * hides this class of defect. Playwright's own actionability checks auto-scroll,
 * so `click()` succeeds on a button a human would never find — which is exactly
 * why "the E2E passes" and "the checkout works on a phone" can disagree.
 */
export async function expectWithinViewportWidth(
  page: Page,
  locator: Locator,
  name: string,
): Promise<void> {
  await expect(locator, `${name} is rendered`).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport, 'the test runs with a real viewport size').not.toBeNull();
  const viewportWidth = viewport!.width;

  const box = await locator.boundingBox();
  expect(box, `${name} has a measurable box`).not.toBeNull();

  expect(
    box!.x,
    `${name} starts ${Math.round(-box!.x)}px off the LEFT edge of a ${viewportWidth}px screen — ` +
      'part of it is unreachable without scrolling sideways',
  ).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE_PX);

  const right = box!.x + box!.width;
  expect(
    right,
    `${name} extends to ${Math.round(right)}px on a ${viewportWidth}px screen — ` +
      `${Math.round(right - viewportWidth)}px of it sits off the RIGHT edge. On a phone this is ` +
      'a control the attendee cannot see or tap, which breaks the flow no matter how correct ' +
      'the underlying logic is.',
  ).toBeLessThanOrEqual(viewportWidth + SUBPIXEL_TOLERANCE_PX);
}

/**
 * Apple's minimum comfortable touch target, and the value Android's Material
 * guidance rounds to (48dp ≈ 44-48px). Below this a control is hit-or-miss with
 * a thumb — which on the door, in the dark, with a queue waiting, means the
 * organizer jabs at it repeatedly and concludes the app is broken.
 */
const MIN_TAP_TARGET_PX = 44;

/**
 * iOS Safari AUTO-ZOOMS the page when a focused input's font-size is under
 * 16px, and does not zoom back out. The form is then wider than the screen with
 * no cue, and the buyer is mid-registration on a page that has jumped sideways.
 * This is a real, common, silent mobile defect and costs nothing to prevent.
 */
const MIN_NO_ZOOM_FONT_PX = 16;

/**
 * Assert a control is big enough to hit with a thumb.
 *
 * Measures the RENDERED box, not the CSS: padding, line-height and a flex
 * parent all move the real number, so a declared `min-height` proves nothing.
 */
export async function expectTapTargetSize(locator: Locator, name: string): Promise<void> {
  await expect(locator, `${name} is rendered`).toBeVisible();

  const box = await locator.boundingBox();
  expect(box, `${name} has a measurable box`).not.toBeNull();

  expect(
    Math.round(box!.height),
    `${name} is only ${Math.round(box!.height)}px tall — under the ${MIN_TAP_TARGET_PX}px ` +
      'minimum touch target. It is reachable with a mouse and fiddly with a thumb, which is ' +
      'the only input this surface actually gets.',
  ).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
}

/**
 * Assert a form control will not trigger iOS Safari's focus zoom.
 *
 * Reads the COMPUTED font-size, so an inherited or media-query value is what
 * gets checked rather than whatever the stylesheet appears to declare.
 */
export async function expectNoIosZoomOnFocus(locator: Locator, name: string): Promise<void> {
  await expect(locator, `${name} is rendered`).toBeVisible();

  const fontSizePx = await locator.evaluate(
    (el) => Number.parseFloat(getComputedStyle(el).fontSize) || 0,
  );

  expect(
    fontSizePx,
    `${name} renders at ${fontSizePx}px, under the ${MIN_NO_ZOOM_FONT_PX}px threshold. iOS ` +
      'Safari zooms the page in when a field this small takes focus and never zooms back out, ' +
      'leaving the buyer part-way through registration on a page that has jumped sideways.',
  ).toBeGreaterThanOrEqual(MIN_NO_ZOOM_FONT_PX);
}

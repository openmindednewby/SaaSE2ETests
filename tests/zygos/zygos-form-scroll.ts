// Scroll/geometry helpers for the instruction form's dropdown tests (UX-6a).
//
// Split out of `zygos-form-fields.ui.spec.ts` on a real seam — that file is capped at 300 lines and
// this is the one part of it that is about LAYOUT MECHANICS rather than about the form's fields.
import { CONSOLE_TEST_IDS } from './zygos-console-ui.js';

import type { Page } from '@playwright/test';

/** Slack (px) allowed between the menu and its trigger before we call it detached. */
export const DETACH_TOLERANCE_PX = 4;
export const SMALL_SCROLL_PX = 80;
export const BIG_SCROLL_PX = 3000;

/**
 * Viewport for the scroll test. SHORTER than `DESKTOP` on purpose: at 900px tall the whole form
 * fits and NOTHING scrolls, so the first version of this test "passed" its reposition check and
 * then failed its close check having never moved a pixel — it looked like a product defect and was
 * not. Verified by probe: at 900px `document.scrollHeight === clientHeight` and there is no
 * scrollable ancestor at all; at 600px the form's container becomes scrollable and the trigger can
 * genuinely leave the viewport.
 */
export const SHORT_VIEWPORT = { width: 1280, height: 600 };

/**
 * Scroll the form's own scroll container and report what actually happened.
 *
 * 🔴 THE DOCUMENT NEVER SCROLLS IN THIS APP. React-Native-Web renders the screen inside a
 * `ScrollView`, which is an inner `<div>` with its own overflow — `window.scrollY`,
 * `document.documentElement.scrollTop` and `page.mouse.wheel` at the default cursor position all
 * stay at 0 forever. A test that "scrolls the page" therefore asserts nothing. This finds the
 * nearest scrollable ancestor of the trigger and scrolls THAT, then returns both how far it
 * actually moved and where the trigger ended up, so the caller can prove the scroll was real
 * before drawing any conclusion from it.
 */
export async function scrollFormBy(page: Page, deltaY: number): Promise<{ scrolled: number; triggerTop: number }> {
  return await page.evaluate(
    ({ triggerId, delta }) => {
      const trigger = document.querySelector(`[data-testid="${triggerId}"]`);
      let node = trigger?.parentElement ?? null;
      let scrolled = 0;

      while (node !== null) {
        if (node.scrollHeight > node.clientHeight + 20 && node.clientHeight > 100) {
          const before = node.scrollTop;
          node.scrollTop = before + delta;
          scrolled = node.scrollTop - before;
          break;
        }
        node = node.parentElement;
      }

      const rect = trigger?.getBoundingClientRect();
      return { scrolled, triggerTop: rect === undefined ? 0 : rect.top };
    },
    { triggerId: CONSOLE_TEST_IDS.formCurrency, delta: deltaY },
  );
}

/**
 * Vertical gap between the currency menu's top edge and its trigger's bottom edge.
 *
 * The single number that expresses "is the menu still attached to its trigger?" — it stays
 * roughly constant while the pair move together and grows without bound the moment the menu is
 * left behind by a scroll. Returns null when either node is gone.
 */
export async function menuOffsetFromTrigger(page: Page): Promise<number | null> {
  return await page.evaluate((triggerId) => {
    const trigger = document.querySelector(`[data-testid="${triggerId}"]`);
    const menu = document.querySelector(`[data-testid="${triggerId}-menu"]`);
    if (trigger === null || menu === null) return null;
    return Math.abs(menu.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom);
  }, CONSOLE_TEST_IDS.formCurrency);
}

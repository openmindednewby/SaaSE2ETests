/**
 * Shared helpers for the kefi-landing parity suite.
 *
 * Two manifest shapes:
 * - `ParityManifest`   — DOM structure + computed typography + section heights.
 * - `AnimationManifest`— animation/transition properties for the key
 *   "always-on" elements (nav, hero, register CTA).
 *
 * Both are extracted via a single `page.evaluate` so the per-spec setup is
 * just "navigate → wait for fonts → call helper".
 */
import type { Page } from '@playwright/test';

/**
 * CSS injected before screenshots / DOM measurement to freeze motion.
 * Targets every selector + before/after pseudo-elements. The `!important`
 * guards against high-specificity selectors in the tenant stylesheets.
 */
export const FREEZE_MOTION_CSS = [
  '*,*::before,*::after{',
  'animation-duration:0s !important;',
  'animation-delay:0s !important;',
  'transition-duration:0s !important;',
  'transition-delay:0s !important;',
  'scroll-behavior:auto !important;',
  '}',
].join('');

/** Per-section measurement returned by `extractParityManifest`. */
export interface SectionMeasurement {
  id: string;
  height: number;
}

/** Computed typography for a chosen element (e.g. `h1`). */
export interface TypographyMeasurement {
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  color: string;
}

export interface ParityManifest {
  /** Viewport inner width at capture time. */
  viewportWidth: number;
  /** Full document scroll height. */
  pageHeight: number;
  /** Computed background color of `<body>`. */
  bodyBg: string;
  /** Hero `h1` computed typography. */
  h1: TypographyMeasurement;
  /** `#mainNav` height (the sticky top nav). */
  navHeight: number;
  /** Visible nav link texts in DOM order (trimmed, dedup'd by structure). */
  navItems: string[];
  /** Per-section heights for every `section[id]` on the page, in DOM order. */
  sections: SectionMeasurement[];
}

/**
 * Element "roles" the animation manifest watches. We name a small set
 * rather than dump every animated element — the standalone and kefi
 * versions may have slightly different DOM trees but the roles are stable.
 */
export type AnimationRole = 'nav' | 'heroBadge' | 'registerCta';

export interface AnimationMeasurement {
  animationName: string;
  animationDuration: string;
  transitionProperty: string;
  transitionDuration: string;
}

export interface AnimationManifest {
  /** Per-role animation/transition properties; missing element → null. */
  byRole: Record<AnimationRole, AnimationMeasurement | null>;
  /** Count of elements on the page with a non-trivial animation or transition. */
  animatedElementCount: number;
}

/**
 * Navigate to `url` and wait until the rendered surface is stable enough
 * for measurement: DOM ready, fonts loaded, images near-complete. Returns
 * once the document is ready to be measured.
 */
export async function gotoAndSettle(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // The <h1> exists in the initial HTML for both standalone and kefi-landings
  // renders, so this is the lightest "page chrome is here" check we can make.
  await page.locator('h1').first().waitFor({ state: 'attached', timeout: 10000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Best-effort wait for images. Some standalones lazy-load below the fold,
  // so we cap the wait at 8s and proceed.
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          const start = Date.now();
          const probe = (): void => {
            const total = document.images.length;
            const loaded = Array.from(document.images).filter(
              (img) => img.complete && img.naturalWidth > 0,
            ).length;
            const elapsedMs = Date.now() - start;
            if (loaded >= total || elapsedMs > 8000) resolve();
            else setTimeout(probe, 250);
          };
          probe();
        }),
    )
    .catch(() => {
      // Image wait is best-effort — never blocks the test.
    });
}

/**
 * Read the DOM + computed-style measurements that the parity suite asserts
 * on. Runs entirely in the page context so it's cheap (~30ms typical).
 */
export async function extractParityManifest(page: Page): Promise<ParityManifest> {
  return page.evaluate(() => {
    const body = document.body;
    const heroH1 = document.querySelector('h1');
    const nav = document.getElementById('mainNav') ?? document.querySelector('nav');
    const navAnchors = nav ? Array.from(nav.querySelectorAll('a')) : [];
    const navItems = navAnchors
      .map((a) => (a.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 40);
    const sections = Array.from(document.querySelectorAll('section[id]')).map((el) => ({
      id: el.id,
      height: Math.round(el.getBoundingClientRect().height),
    }));
    const h1Style = heroH1 ? getComputedStyle(heroH1) : null;
    return {
      viewportWidth: window.innerWidth,
      pageHeight: document.documentElement.scrollHeight,
      bodyBg: getComputedStyle(body).backgroundColor,
      h1: {
        fontSize: h1Style?.fontSize ?? '',
        fontFamily: h1Style?.fontFamily ?? '',
        fontWeight: h1Style?.fontWeight ?? '',
        color: h1Style?.color ?? '',
      },
      navHeight: nav?.getBoundingClientRect().height ?? 0,
      navItems,
      sections,
    };
  });
}

/**
 * Capture the animation manifest — runs BEFORE any motion-freeze CSS is
 * injected, otherwise every value collapses to "0s".
 */
export async function extractAnimationManifest(page: Page): Promise<AnimationManifest> {
  return page.evaluate(() => {
    type Role = 'nav' | 'heroBadge' | 'registerCta';
    const pickAnimation = (
      el: Element | null,
    ): {
      animationName: string;
      animationDuration: string;
      transitionProperty: string;
      transitionDuration: string;
    } | null => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        animationName: s.animationName,
        animationDuration: s.animationDuration,
        transitionProperty: s.transitionProperty,
        transitionDuration: s.transitionDuration,
      };
    };
    const nav = document.getElementById('mainNav') ?? document.querySelector('nav');
    const heroBadge =
      document.querySelector('.hero-badge, [data-role=hero-badge], header .pill') ??
      document.querySelector('header .badge');
    const register = document.getElementById('register');
    const registerCta = register
      ? (register.querySelector('a.button, button, .cta a, a[href*=register]') as Element | null)
      : null;
    const animated = Array.from(document.querySelectorAll('*')).filter((el) => {
      const s = getComputedStyle(el);
      const hasAnim = s.animationName && s.animationName !== 'none';
      const hasTrans =
        s.transitionProperty &&
        s.transitionProperty !== 'none' &&
        s.transitionProperty !== 'all' &&
        parseFloat(s.transitionDuration) > 0;
      return hasAnim || hasTrans;
    });
    const byRole: Record<Role, ReturnType<typeof pickAnimation>> = {
      nav: pickAnimation(nav),
      heroBadge: pickAnimation(heroBadge),
      registerCta: pickAnimation(registerCta),
    };
    return {
      byRole,
      animatedElementCount: animated.length,
    };
  });
}

/**
 * Inject the freeze-motion stylesheet. Call AFTER the animation manifest
 * is captured but BEFORE any pixel comparison so screenshots are stable.
 */
export async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({ content: FREEZE_MOTION_CSS });
}

/** Compute the absolute drift ratio between two height values. */
export function heightDriftRatio(a: number, b: number): number {
  const ref = Math.max(a, 1);
  return Math.abs(a - b) / ref;
}

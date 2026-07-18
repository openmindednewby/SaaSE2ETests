// Raw-translation-key detector (UX-6a) — the shared scanner behind the i18n guard spec.
//
// ── The bug class ─────────────────────────────────────────────────────────────────────────────
//
// `FM()` has NO fallback by design. A key that is missing from
// `zygos-web/src/localization/locales/en.json` therefore renders its own LITERAL DOTTED NAME to
// the operator — `common.selectPlaceholder` sitting in an unset dropdown, the `uiTables.filters.*`
// family across the filter bar, `quizTemplates.cancel` as a close button's a11y label. 44 keys
// were missing at once, because the shared kit (`@dloizides/ui-layout`, `ui-tables`,
// `ui-feedback`) resolves ITS strings through the HOST app's `FM` — so every kit upgrade can add
// keys the host has never heard of, and nothing in the build says so.
//
// 🔴 WHY THIS ALSO READS ATTRIBUTES, NOT JUST VISIBLE TEXT. The `quizTemplates.cancel` defect
// lived in `ModalShell`'s close-button `aria-label`. It is invisible to a screenshot, invisible to
// a human reading the page, and invisible to any scan that only walks text nodes — but a screen
// reader announces the raw key verbatim. A text-only scan reports green on the exact bug that
// motivated the wave, so attributes are in scope here, not an extra.
//
// ── Why the shape test alone is not enough ────────────────────────────────────────────────────
//
// `^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){1,5}$` also matches perfectly legitimate on-screen strings:
// `statement.pdf`, `app.zygos.dloizides.com`, `v1.2.3`. A guard that cries wolf on a filename gets
// muted, and a muted guard is worse than no guard. So a hit must survive `isLegitimateDottedText`
// as well — a small, explicit, auditable exclusion list rather than a fuzzy score.

/** Where a raw key was found. `text` = a visible text node; anything else = that attribute. */
export type RawKeySource = 'text' | 'aria-label' | 'aria-placeholder' | 'placeholder' | 'title' | 'alt';

export interface RawKeyHit {
  /** The offending string, e.g. `common.selectPlaceholder`. */
  readonly text: string;
  /** `text`, or the attribute that carried it. */
  readonly source: RawKeySource;
  /** A short DOM breadcrumb (tag + nearest data-testid) to locate it. */
  readonly where: string;
}

/** The attributes a raw key can hide in. `aria-label` is the one that mattered. */
const SCANNED_ATTRIBUTES: readonly RawKeySource[] = ['aria-label', 'aria-placeholder', 'placeholder', 'title', 'alt'];

/**
 * The dotted-key shape: a lowercase-initial camelCase head, then 1–5 dotted segments.
 * Anchored, so any surrounding prose disqualifies it — real copy is never a bare token.
 */
const DOTTED_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){1,5}$/;

/** Trailing segments that make a dotted token a filename rather than a key. */
const FILE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'pdf', 'csv', 'xlsx', 'xls',
  'json', 'xml', 'txt', 'zip', 'js', 'ts', 'tsx', 'css', 'html', 'map', 'woff', 'woff2',
]);

/** Trailing segments that make a dotted token a hostname rather than a key. */
const TLDS = new Set(['com', 'net', 'org', 'io', 'dev', 'app', 'eu', 'uk', 'local', 'localhost', 'test', 'internal']);

/**
 * Is this dotted token legitimately on screen (so NOT a raw key)?
 *
 * Deliberately conservative: each rule excludes a concrete, real-world string shape this console
 * can actually display. Anything not covered here is reported, because a false ALARM costs one
 * look at a failure message while a false PASS ships a raw key to a customer.
 */
export function isLegitimateDottedText(value: string): boolean {
  const segments = value.split('.');
  const last = segments[segments.length - 1]?.toLowerCase() ?? '';

  // statement.pdf, logo.svg — a filename.
  if (FILE_EXTENSIONS.has(last)) return true;

  // app.zygos.dloizides.com — a hostname.
  if (TLDS.has(last)) return true;

  // v1.2.3, 1.5 — every segment after the head is numeric, so it is a version or a decimal.
  if (segments.slice(1).every((segment) => /^\d+$/.test(segment))) return true;

  return false;
}

/** Does this string look like a raw, untranslated `FM()` key? */
export function isRawTranslationKey(value: string): boolean {
  const trimmed = value.trim();
  if (!DOTTED_KEY.test(trimmed)) return false;
  return !isLegitimateDottedText(trimmed);
}

/** One candidate string lifted out of the DOM, before the key test is applied. */
interface DomCandidate {
  readonly text: string;
  readonly source: RawKeySource;
  readonly where: string;
}

/**
 * Pull every VISIBLE string out of the live DOM — text nodes plus the scanned attributes.
 *
 * Runs entirely inside the page (one round trip) and makes no judgements there: the key test
 * stays in Node where it is readable, unit-testable and reported with context. Visibility is
 * `getClientRects()` + computed style, so collapsed drawers, closed menus and the RN-web
 * `display:none` screens Expo Router keeps mounted cannot contribute phantom hits.
 */
export async function collectDomStrings(
  page: import('@playwright/test').Page,
  attributes: readonly RawKeySource[] = SCANNED_ATTRIBUTES,
): Promise<DomCandidate[]> {
  return (await page.evaluate((attrs) => {
    const out: { text: string; source: string; where: string }[] = [];

    const isVisible = (el: Element): boolean => {
      if (el.getClientRects().length === 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    };

    /** tag + the nearest data-testid ancestor — enough to find the node by hand. */
    const describe = (el: Element): string => {
      const owner = el.closest('[data-testid]');
      const testId = owner?.getAttribute('data-testid');
      return testId === null || testId === undefined ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()} in [${testId}]`;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      const value = (node.nodeValue ?? '').trim();
      const parent = node.parentElement;
      if (value !== '' && parent !== null && isVisible(parent)) {
        out.push({ text: value, source: 'text', where: describe(parent) });
      }
      node = walker.nextNode();
    }

    for (const attr of attrs) {
      for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
        const value = (el.getAttribute(attr) ?? '').trim();
        // NB: attributes are read even on nodes that are not laid out themselves (an a11y label
        // on a zero-size node is still announced), but the OWNER must be on screen.
        if (value !== '' && isVisible(el)) out.push({ text: value, source: attr, where: describe(el) });
      }
    }

    return out;
  }, attributes)) as DomCandidate[];
}

/** Every raw key currently rendered on the page, de-duplicated by text+source+location. */
export async function findRawKeys(page: import('@playwright/test').Page): Promise<RawKeyHit[]> {
  const candidates = await collectDomStrings(page);
  const seen = new Set<string>();
  const hits: RawKeyHit[] = [];

  for (const candidate of candidates) {
    if (!isRawTranslationKey(candidate.text)) continue;
    const fingerprint = `${candidate.text}|${candidate.source}|${candidate.where}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    hits.push(candidate);
  }

  return hits;
}

/** A failure message that names the key, the screen and how it was rendered. */
export function describeRawKeys(screen: string, hits: readonly RawKeyHit[]): string {
  const lines = hits.map((hit) => `  • "${hit.text}"  [${hit.source}]  ${hit.where}`);
  return (
    `${String(hits.length)} raw translation key(s) rendered on "${screen}" — FM() has no fallback, so ` +
    `each of these is the literal key shown to the operator. Add them to ` +
    `zygos-web/src/localization/locales/en.json:\n${lines.join('\n')}`
  );
}

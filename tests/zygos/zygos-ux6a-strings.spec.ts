// Zygos UX-6a strings — the FAST tier of the i18n guard (@api).
//
// The two-tier convention, applied where it actually pays: the @ui tier
// (`zygos-i18n.ui.spec.ts`) drives five screens in a browser to prove no raw key REACHES an
// operator. That is the real assertion, and it costs a login plus five navigations. This tier
// answers the cheaper, earlier question — "did the dictionary that makes those screens correct
// even ship?" — with two HTTP requests and no session at all.
//
// 🔴 IT CHECKS THE DEPLOYED ARTEFACT, NOT THE REPO. Reading
// `zygos-web/src/localization/locales/en.json` off disk would prove a fact about a working copy
// that no user visits, and it would break outright when this suite runs as an in-cluster K8s Job
// with no source tree. The same reasoning as `zygos-pwa.spec.ts`: "a green build is not evidence
// for this class of bug — only a fetch of the live host is." So the strings are looked for in the
// JavaScript Expo actually serves.
//
// This tier can only find keys the app OWNS. A key the shared kit invents and the host has never
// defined still needs the browser tier to catch it in situ — which is exactly why both exist.
import { expect, test } from '@playwright/test';

import { ZYGOS_WEB_URL, bodyText } from './zygos-helpers.js';

/**
 * Translation VALUES the UX-6a wave depends on. Values, not keys: a key present with an empty or
 * placeholder value would still render wrong, and the value is what the operator reads.
 *
 * Each entry names the surface it belongs to so a failure points somewhere, and every one of
 * these was among the 44 missing when the wave started.
 */
const REQUIRED_STRINGS: readonly { value: string; surface: string }[] = [
  { value: 'Select…', surface: 'common.selectPlaceholder — an unset dropdown' },
  { value: 'Choose a currency.', surface: 'instructions.form.error.currencyInvalid — the currency Field error' },
  { value: 'Choose a direction.', surface: 'instructions.form.error.directionInvalid — the direction Field error' },
  { value: 'Showing', surface: 'common.showing — the Pager count-line prefix' },
  // 🔴 Added after the @ui tier caught this INTERMITTENTLY and the fast tier could not.
  // `AuditTrail` renders `FM('common.loading')` while the instruction detail's SECOND async load
  // is in flight, so a missing key here shows the operator `common.loading` — but only inside a
  // load window a browser test may or may not observe. The dictionary check has no such race:
  // the value either shipped or it did not.
  { value: 'Loading…', surface: 'common.loading — AuditTrail while the audit entries load' },
];

/** Expo emits hashed chunks; the shared kit + dictionary land in the common chunk. */
const BUNDLE_PATTERN = /\/_expo\/static\/js\/web\/[^"']+\.js/g;

/**
 * 🔴 THE MINIFIER ESCAPES NON-ASCII, so a plain `includes` is WRONG and reports strings missing that are
 * in fact present. The dictionary ships as `routing:"Signing you in\u2026"` — the six ASCII
 * characters `\u2026`, not the ellipsis glyph. Required values here end in an ellipsis, so the
 * naive check would have reported them missing forever, including after a correct deploy — a
 * permanent false alarm, which is the fastest way to get a guard ignored.
 *
 * Checking BOTH forms is deliberate: Expo does not escape consistently across chunk boundaries
 * or minifier settings, so neither form alone is safe to rely on.
 */
function bundleContains(script: string, value: string): boolean {
  if (script.includes(value)) return true;

  // Built by codepoint rather than a regex range: an ASCII-range character class needs literal
  // control characters in the source, which the no-control-regex lint rule (correctly) rejects.
  const ASCII_MAX = 127;
  const escaped = [...value]
    .map((char) =>
      char.charCodeAt(0) > ASCII_MAX
        ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
        : char,
    )
    .join('');

  return script.includes(escaped);
}

test.describe('Zygos UX-6a strings @zygos-api @api', () => {
  test('🔴 the deployed bundle ships the UX-6a translation values (FM has no fallback)', async ({ request }) => {
    const shell = await request.get(`${ZYGOS_WEB_URL}/`);
    expect(shell.status(), `GET / failed: ${await bodyText(shell)}`).toBe(200);

    const html = await shell.text();
    const bundles = [...new Set(html.match(BUNDLE_PATTERN) ?? [])];
    expect(
      bundles.length,
      'the served shell references no /_expo/static/js/web/*.js chunk — the export shape changed and this ' +
        'check can no longer find the dictionary. Update BUNDLE_PATTERN.',
    ).toBeGreaterThan(0);

    // Concatenate the chunks once, then test every string against the whole. Cheaper and far
    // clearer to debug than per-chunk bookkeeping, and chunk boundaries are not our business.
    let script = '';
    for (const bundle of bundles) {
      const res = await request.get(`${ZYGOS_WEB_URL}${bundle}`);
      if (res.status() === 200) script += await res.text();
    }
    expect(script.length, 'every referenced JS chunk failed to download').toBeGreaterThan(0);

    const missing = REQUIRED_STRINGS.filter((entry) => !bundleContains(script, entry.value));
    expect(
      missing,
      missing.length === 0
        ? ''
        : `the deployed bundle is missing ${String(missing.length)} UX-6a translation value(s). FM() has no ` +
          `fallback, so each one renders its raw dotted key to the operator:\n` +
          missing.map((entry) => `  • "${entry.value}"  — ${entry.surface}`).join('\n'),
    ).toEqual([]);
  });
});

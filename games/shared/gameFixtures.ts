/**
 * Cross-game test fixtures. Every portfolio game with a URL test-mode
 * adopts the same protocol and uses these helpers:
 *
 *   1. Build a URL with `?test=1` plus game-specific params.
 *   2. Navigate to it.
 *   3. Wait for a `[TEST] result=<...> reason=<...> ticks=<...>` line
 *      in the browser console (mirrored via JavaScriptBridge / equivalent).
 *   4. Parse + assert.
 *
 * The shape of the URL is per-game; the result protocol is universal.
 */
import type { Page, ConsoleMessage } from '@playwright/test';

export const SOLID_STATE_BASE = process.env.SOLID_STATE_URL ?? 'https://solid-state.dloizides.com/';

export interface TestResult {
  result: 'win' | 'loss' | 'stalemate' | 'unknown';
  reason: string;
  ticks: number;
  rawLine: string;
}

/**
 * Wait for the first `[TEST] result=...` line in the page's console
 * output, parse it, return the structured result. Throws if no line
 * appears within `timeoutMs`.
 *
 * Subscribes to console events BEFORE navigation so we don't miss a
 * fast-firing line (some scenarios resolve in 2-3 sim ticks ≈ 1 second).
 */
export function captureTestResult(page: Page, timeoutMs = 30_000): Promise<TestResult> {
  return new Promise<TestResult>((resolve, reject) => {
    const handler = (msg: ConsoleMessage) => {
      const text = msg.text();
      if (!text.startsWith('[TEST] ')) return;
      page.off('console', handler);
      const m = /^\[TEST\] result=(\S+) reason=(\S+) ticks=(\d+)/.exec(text);
      if (!m) {
        reject(new Error(`malformed test line: ${text}`));
        return;
      }
      resolve({
        result: m[1] as TestResult['result'],
        reason: m[2],
        ticks: Number(m[3]),
        rawLine: text,
      });
    };
    page.on('console', handler);
    setTimeout(() => {
      page.off('console', handler);
      reject(new Error(`timeout: no [TEST] line in ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Navigate the page to a URL with game-specific test params attached and
 * resolve when a [TEST] line arrives. Convenience wrapper that combines
 * `captureTestResult` + `page.goto`.
 */
export async function runScenario(
  page: Page,
  baseUrl: string,
  params: Record<string, string>,
  timeoutMs?: number,
): Promise<TestResult> {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // Bust the asset cache so each test run hits the latest deployed build.
  url.searchParams.set('_b', String(Date.now()));
  // Subscribe BEFORE navigation so the [TEST] line never races us.
  const resultPromise = captureTestResult(page, timeoutMs);
  await page.goto(url.toString(), { waitUntil: 'commit' });
  return resultPromise;
}

/**
 * Console + page-error capture for browser specs.
 *
 * A page can render perfectly and still be broken: an uncaught TypeError in the
 * register form's inline submit handler leaves every element on screen, passes
 * every layout assertion, and silently does nothing when the buyer presses
 * Register. `toBeVisible()` cannot see that. The console can.
 *
 * Usage — attach BEFORE the first navigation, assert at the end:
 *
 *   const console = attachConsoleGuard(page);
 *   await page.goto(url);
 *   ...
 *   console.expectClean('the UBB register page');
 *
 * Two channels are captured because they fail differently:
 *   - `console.error` — the page reporting a handled problem (a failed fetch it
 *     logged, a React warning escalated to error).
 *   - `pageerror`     — an UNCAUGHT exception. Strictly worse: whatever handler
 *     threw did not finish, so some behaviour the user asked for did not happen.
 */

import { type ConsoleMessage, type Page, expect } from '@playwright/test';

/** How many captured messages to quote in a failure before truncating. */
const MAX_REPORTED_MESSAGES = 10;

/** One captured problem. */
interface CapturedProblem {
  kind: 'console.error' | 'pageerror';
  text: string;
}

/** A live capture attached to one page. */
export interface ConsoleGuard {
  /** Every problem captured so far, in order. */
  problems(): CapturedProblem[];
  /**
   * Discard everything captured so far.
   *
   * For asserting on a surface that can only be reached THROUGH another one.
   * Signing in necessarily loads the app unauthenticated first, and the session
   * probe `GET /bff/me` answers 401 by design at that moment — the browser logs
   * every failed fetch as a console error, so an organizer spec inherits a
   * guaranteed 401 that has nothing to do with the screen under test.
   *
   * Call this once the target surface is loaded. Prefer it to an `allow`
   * pattern for this case: the console text is only "Failed to load resource:
   * the server responded with a status of 401 ()" with NO URL, so an allow
   * pattern broad enough to match it would also swallow a genuine 401 from the
   * screen you are testing — the precise failure these specs exist to catch.
   */
  reset(): void;
  /**
   * Assert nothing was logged. `allow` drops messages matching any pattern —
   * use it only for noise the product genuinely cannot control (a third-party
   * script, a browser deprecation notice), never to silence a real defect.
   */
  expectClean(surface: string, allow?: readonly RegExp[]): void;
}

/**
 * Start capturing. Attach before navigating — listeners registered after a
 * `goto` miss everything the page logged while loading, which is exactly when
 * a broken inline script fails.
 */
export function attachConsoleGuard(page: Page): ConsoleGuard {
  const captured: CapturedProblem[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') {
      captured.push({ kind: 'console.error', text: message.text() });
    }
  });

  page.on('pageerror', (error: Error) => {
    captured.push({ kind: 'pageerror', text: `${error.name}: ${error.message}` });
  });

  return {
    problems: () => [...captured],
    reset: (): void => {
      captured.length = 0;
    },
    expectClean: (surface: string, allow: readonly RegExp[] = []): void => {
      const offenders = captured.filter(
        (problem) => !allow.some((pattern) => pattern.test(problem.text)),
      );

      const detail = offenders
        .slice(0, MAX_REPORTED_MESSAGES)
        .map((problem) => `      • [${problem.kind}] ${problem.text}`)
        .join('\n');
      const truncated =
        offenders.length > MAX_REPORTED_MESSAGES
          ? `\n      … and ${offenders.length - MAX_REPORTED_MESSAGES} more`
          : '';

      expect(
        offenders,
        `${surface} logged ${offenders.length} console error(s)/uncaught exception(s). An ` +
          'uncaught error means a handler stopped mid-way, so a control can look perfectly ' +
          'fine and still do nothing when pressed:\n' +
          `${detail}${truncated}\n`,
      ).toEqual([]);
    },
  };
}

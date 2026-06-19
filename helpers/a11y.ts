/**
 * Accessibility (a11y) helper — wraps `@axe-core/playwright` for the E2E suite.
 *
 * Today a11y is enforced only at lint time (eslint react-native-a11y) and via
 * the Lighthouse a11y score. This helper adds in-suite axe assertions so a
 * deployed page that regresses on a real WCAG rule fails an E2E run.
 *
 * Policy (see C7 polish, Batch 3):
 *   - FAIL the test on any violation of impact `critical` or `serious`.
 *   - REPORT (do not fail) violations of impact `moderate` or `minor` — these
 *     are surfaced via a test annotation + the returned summary so we can track
 *     and burn them down without blocking the suite yet.
 *
 * The failure message lists each blocking violation as
 *   <rule-id> (<impact>): <help>  →  <node target>, <node target>, ...
 * so a red run points straight at the offending rule + DOM node.
 *
 * Usage in a spec:
 *
 *   import { test } from '@playwright/test';
 *   import { scanA11y } from '../../helpers/a11y.js';
 *
 *   test('home page has no critical/serious a11y violations', async ({ page }) => {
 *     await page.goto('https://example.com');
 *     await scanA11y(page, { label: 'example home' });
 *   });
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { test } from '@playwright/test';

/** axe-core impact levels, ordered most → least severe. */
export type A11yImpact = 'critical' | 'serious' | 'moderate' | 'minor';

/** Impacts that FAIL the test. */
const BLOCKING_IMPACTS: readonly A11yImpact[] = ['critical', 'serious'];

/** WCAG tag sets we assert against (WCAG 2.0/2.1 A + AA + best practice). */
const DEFAULT_WCAG_TAGS: readonly string[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'best-practice',
];

/** Per-impact violation counts for a single page scan. */
export interface A11yImpactCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

/** Summary returned by {@link scanA11y} for reporting/aggregation. */
export interface A11ySummary {
  /** Human-readable label for the scanned surface (e.g. "erevna login"). */
  label: string;
  /** The URL that was actually scanned. */
  url: string;
  /** Violation counts bucketed by impact. */
  counts: A11yImpactCounts;
  /** Total number of distinct rule violations across all impacts. */
  total: number;
}

interface ScanOptions {
  /** Human-readable label for the surface, used in messages + annotations. */
  label: string;
  /** Override the WCAG tag set. Defaults to {@link DEFAULT_WCAG_TAGS}. */
  tags?: readonly string[];
  /**
   * CSS selectors to EXCLUDE from the scan (e.g. a known-bad third-party
   * widget). Use sparingly — every exclusion hides a real rule.
   */
  exclude?: readonly string[];
}

interface AxeNode {
  target: ReadonlyArray<string | string[]>;
}

interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

function emptyCounts(): A11yImpactCounts {
  return { critical: 0, serious: 0, moderate: 0, minor: 0 };
}

function isImpact(value: string | null | undefined): value is A11yImpact {
  return (
    value === 'critical' ||
    value === 'serious' ||
    value === 'moderate' ||
    value === 'minor'
  );
}

/** Flatten an axe node target (which may nest for iframes) to a string. */
function targetToString(node: AxeNode): string {
  return node.target.map((t) => (Array.isArray(t) ? t.join(' >>> ') : t)).join(', ');
}

/** Build the human-readable failure block for a set of blocking violations. */
function formatViolations(label: string, violations: AxeViolation[]): string {
  const lines = violations.map((v) => {
    const targets = v.nodes
      .slice(0, MAX_NODES_LISTED)
      .map((n) => `      → ${targetToString(n)}`)
      .join('\n');
    const more =
      v.nodes.length > MAX_NODES_LISTED
        ? `\n      → … and ${v.nodes.length - MAX_NODES_LISTED} more node(s)`
        : '';
    return `  • ${v.id} (${v.impact}): ${v.help}\n    ${v.helpUrl}\n${targets}${more}`;
  });
  return `[a11y] ${label}: ${violations.length} blocking (critical/serious) violation(s):\n${lines.join(
    '\n',
  )}`;
}

/** Cap the per-violation node list so failure output stays readable. */
const MAX_NODES_LISTED = 5;

function countByImpact(violations: AxeViolation[]): A11yImpactCounts {
  const counts = emptyCounts();
  for (const v of violations) {
    if (isImpact(v.impact)) counts[v.impact] += 1;
  }
  return counts;
}

/**
 * Run an axe scan on the CURRENT page state and enforce the a11y policy.
 *
 * - Fails the test (via `expect`) if any critical/serious violation exists,
 *   with a message listing each rule + offending node target(s).
 * - Records a `a11y:<label>` annotation with the full per-impact counts so a
 *   PASSING run is still interpretable ("0 blocking, 3 moderate, 1 minor").
 *
 * @returns the per-impact summary for the scanned page.
 */
export async function scanA11y(page: Page, options: ScanOptions): Promise<A11ySummary> {
  const { label, tags = DEFAULT_WCAG_TAGS, exclude = [] } = options;

  let builder = new AxeBuilder({ page }).withTags([...tags]);
  for (const selector of exclude) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();
  const violations = results.violations as unknown as AxeViolation[];
  const counts = countByImpact(violations);
  const total = violations.length;
  const url = page.url();

  const summary: A11ySummary = { label, url, counts, total };

  // Annotate the test so the report shows the breakdown even on a pass.
  const info: TestInfo | undefined = safeTestInfo();
  if (info) {
    info.annotations.push({
      type: 'a11y',
      description: `${label} [${url}] — critical:${counts.critical} serious:${counts.serious} moderate:${counts.moderate} minor:${counts.minor}`,
    });
  }

  const blocking = violations.filter(
    (v) => isImpact(v.impact) && BLOCKING_IMPACTS.includes(v.impact),
  );

  // Web-first: a clear, node-level message when blocking violations exist.
  expect(blocking, formatViolations(label, blocking)).toHaveLength(0);

  return summary;
}

/**
 * `test.info()` throws if called outside a running test. The helper is only
 * ever called inside a test, but guard so a misuse degrades to "no annotation"
 * rather than an exception that masks the real assertion.
 */
function safeTestInfo(): TestInfo | undefined {
  try {
    return test.info();
  } catch {
    return undefined;
  }
}

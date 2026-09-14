// Probes for aml-gdelt-page-qa.spec.ts: network/console observation and the narrow-viewport width scan.
import type { Page } from '@playwright/test';

const BACKFILL_PROGRESS_SUFFIX = '/adverse-media/backfill/progress';
/** The polled job feed: GET /v1/jobs (src/api/generated/jobs/amlJobs.ts:64), behind the BFF prefix. */
const JOB_FEED = /\/v1\/jobs$/;
const HTTP_CLIENT_ERROR = 400;
const EDGE_TOLERANCE_PX = 0.5;
const MAX_REPORTED = 25;

export interface Observed {
  readonly consoleErrors: string[];
  readonly badResponses: string[];
  /** Request timestamps — requests, not responses, so a pile-up of in-flight calls is counted. */
  readonly progress: number[];
  readonly jobFeed: number[];
}

export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

export function observePage(page: Page, origin: string): Observed {
  const seen: Observed = { consoleErrors: [], badResponses: [], progress: [], jobFeed: [] };
  page.on('console', message => {
    if (message.type() === 'error') seen.consoleErrors.push(`${message.text()} @ ${message.location().url}`);
  });
  page.on('pageerror', error => seen.consoleErrors.push(`pageerror ${error.name}: ${error.message}`));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return;
    if (url.pathname.endsWith(BACKFILL_PROGRESS_SUFFIX)) seen.progress.push(Date.now());
    if (JOB_FEED.test(url.pathname)) seen.jobFeed.push(Date.now());
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(origin))
      seen.badResponses.push(`failed ${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() >= HTTP_CLIENT_ERROR)
      seen.badResponses.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
  });
  return seen;
}

export interface WidthScan {
  /** `testID right=px` for visible elements past the edge that no horizontal scroller contains. */
  readonly offenders: string[];
  /** Horizontal scrollers (tables) that legitimately hold wider content, by testID. */
  readonly contained: string[];
}

/**
 * Every visible element whose right edge passes `limit`. An element inside its OWN horizontal scroller
 * (overflow-x auto/scroll that actually scrolls and itself fits) is contained, not an offender — the
 * web-app standard allows tables that. A full-width scroller does NOT exempt: that is the page itself
 * scrolling sideways. Elements under a zero-height clipping ancestor (a closed accordion) are skipped.
 */
export async function findWidthOffenders(page: Page, limit: number): Promise<WidthScan> {
  return page.evaluate(
    ({ edge, tolerance, max }) => {
      const label = (el: Element): string =>
        el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName.toLowerCase();
      const offenders = new Map<string, number>();
      const contained = new Set<string>();
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || rect.right <= edge + tolerance) continue;
        let skip = false;
        for (let anc = el.parentElement; anc !== null && anc !== document.body; anc = anc.parentElement) {
          const style = getComputedStyle(anc);
          const box = anc.getBoundingClientRect();
          if (style.overflow !== 'visible' && box.height === 0) {
            skip = true;
            break;
          }
          const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
          const ownScroller = scrollsX && anc.scrollWidth > anc.clientWidth && box.right <= edge + tolerance;
          if (ownScroller && box.left > tolerance) {
            contained.add(label(anc));
            skip = true;
            break;
          }
        }
        if (skip) continue;
        const key = label(el);
        offenders.set(key, Math.max(offenders.get(key) ?? 0, Math.round(rect.right)));
      }
      return {
        offenders: Array.from(offenders, ([key, right]) => `${key} right=${right}`).slice(0, max),
        contained: Array.from(contained).slice(0, max),
      };
    },
    { edge: limit, tolerance: EDGE_TOLERANCE_PX, max: MAX_REPORTED },
  );
}

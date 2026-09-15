import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Page, type Request } from '@playwright/test';

import { TestIds } from '../../nextgame-web/src/shared/testIds';
import { ANALYTICS_HOST, POLICY_VERSION } from '../../nextgame-web/src/shared/privacyFacts';

/**
 * Everything the browser specs assert is read from the SPA's OWN source — testIds, the English
 * locale, the policy version, the analytics host — so a copy change or a version bump moves the
 * expectation with it instead of leaving a hardcoded string to go stale.
 */
// Default is the Tilt `nextgame-web` resource: the prod expo export behind the real nginx.conf.
// NEXTGAME_BASE_URL (e.g. https://nextgame.dloizides.com) targets a deployed host for the whole suite.
export const SPA_URL = process.env.NEXTGAME_WEB_URL ?? process.env.NEXTGAME_BASE_URL ?? 'http://localhost:8091';

/** The Umami website id baked into app/+html.tsx for nextgame. */
export const UMAMI_WEBSITE_ID = 'b3560325-b595-41d7-989a-1db789edfb50';

export const HTTP_OK = 200;
export const HTTP_NOT_FOUND = 404;
export const MIN_TARGET_PX = 44;
export const MOBILE_VIEWPORT = { width: 400, height: 860 };

interface EnLocale {
  seo: { titles: Record<string, string> };
  privacy: { updated: string; analyticsHeading: string };
  age: { consentFailed: string };
}

const en = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'nextgame-web', 'src', 'localization', 'locales', 'en.json'), 'utf8'),
) as EnLocale;

function title(key: string): string {
  const value = en.seo.titles[key];
  if (!value) throw new Error(`nextgame-web en.json has no seo.titles.${key}`);
  return value;
}

export interface SpaRoute {
  name: string;
  path: string;
  title: string;
  screenTestId: string;
}

/**
 * Every current route, in the D1 flow order:
 * / -> /welcome -> /age -> /consent -> /importing -> /profile -> /quiz -> /platforms -> /results,
 * plus /empty-library, /privacy and /error. A signed-out visitor can open any of these directly —
 * the session/flow-gated ones (all but landing/privacy) may client-side redirect away, which is
 * NOT a failure (see nextgame-console.spec.ts); only landing/privacy/age are asserted to render
 * their OWN screen and title on a hard load (nextgame-browser.spec.ts), because those three are
 * the only ones known not to be gated.
 */
export const REAL_ROUTES: SpaRoute[] = [
  { name: 'landing', path: '/', title: title('landing'), screenTestId: TestIds.LANDING_SCREEN },
  { name: 'welcome', path: '/welcome', title: title('welcome'), screenTestId: TestIds.WELCOME_SCREEN },
  { name: 'age', path: '/age', title: title('age'), screenTestId: TestIds.AGE_SCREEN },
  { name: 'consent', path: '/consent', title: title('consent'), screenTestId: TestIds.CONSENT_SCREEN },
  { name: 'importing', path: '/importing', title: title('importing'), screenTestId: TestIds.IMPORTING_SCREEN },
  { name: 'profile', path: '/profile', title: title('profile'), screenTestId: TestIds.PROFILE_SCREEN },
  { name: 'quiz', path: '/quiz', title: title('quiz'), screenTestId: TestIds.QUIZ_SCREEN },
  { name: 'platforms', path: '/platforms', title: title('platforms'), screenTestId: TestIds.PLATFORMS_SCREEN },
  { name: 'results', path: '/results', title: title('results'), screenTestId: TestIds.RESULTS_SCREEN },
  { name: 'empty-library', path: '/empty-library', title: title('emptyLibrary'), screenTestId: TestIds.EMPTY_LIBRARY_SCREEN },
  { name: 'privacy', path: '/privacy', title: title('privacy'), screenTestId: TestIds.PRIVACY_SCREEN },
  { name: 'error', path: '/error', title: title('error'), screenTestId: TestIds.ERROR_SCREEN },
];

/** The subset known NOT to be session/flow-gated: a hard load renders that route's OWN screen. */
export const UNGATED_ROUTES: SpaRoute[] = REAL_ROUTES.filter((route) => ['landing', 'privacy', 'age'].includes(route.name));

export const NOT_FOUND_ROUTE: SpaRoute = {
  name: 'not-found',
  path: '/definitely-not-a-route',
  title: title('notFound'),
  screenTestId: TestIds.NOT_FOUND_SCREEN,
};

export const POLICY_VERSION_TEXT = en.privacy.updated.replace('{{p1}}', POLICY_VERSION);
export const ANALYTICS_HEADING = en.privacy.analyticsHeading;
export const AGE_CONSENT_FAILED_TEXT = en.age.consentFailed;

/**
 * Fulfils every analytics POST in the browser, so a test run never records a localhost pageview
 * on the real Umami site. Routed on the CONTEXT, not the page: Chromium sends service-worker
 * traffic through context routes only. Non-POSTs (the tracker script itself) pass through.
 * Returns the live list of intercepted requests — a beacon that is NOT in it reached the server.
 */
export async function interceptAnalytics(page: Page): Promise<Request[]> {
  const intercepted: Request[] = [];
  await page.context().route(`https://${ANALYTICS_HOST}/**`, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    intercepted.push(request);
    await route.fulfill({ status: HTTP_OK, contentType: 'application/json', body: '{}' });
  });
  return intercepted;
}

/**
 * The page-view beacon is the last thing the booted app does, so it is the readiness signal that
 * replaces networkidle: boot-time errors have landed and the loader is gone by the time it fires.
 */
export async function expectPageViewBeacon(intercepted: Request[]): Promise<void> {
  await expect.poll(() => intercepted.length, 'the app never sent its page-view beacon').toBeGreaterThan(0);
}

/**
 * Collects console errors and uncaught page errors. The ONE excused error: Chrome logs the
 * not-found document's own 404 as a failed resource — excused only when its location IS the
 * not-found URL, never for any other resource.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const isNotFoundDocument =
      message.location().url === `${SPA_URL}${NOT_FOUND_ROUTE.path}` && message.text().includes(String(HTTP_NOT_FOUND));
    if (!isNotFoundDocument) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

export { ANALYTICS_HOST, TestIds };

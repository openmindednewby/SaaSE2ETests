import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestIds } from '../../nextgame-web/src/shared/testIds';
import { ANALYTICS_HOST, POLICY_VERSION } from '../../nextgame-web/src/shared/privacyFacts';

/**
 * Everything the browser specs assert is read from the SPA's OWN source — testIds, the English
 * locale, the policy version, the analytics host — so a copy change or a version bump moves the
 * expectation with it instead of leaving a hardcoded string to go stale.
 */
// Default is the Tilt `nextgame-web` resource: the prod expo export behind the real nginx.conf.
export const SPA_URL = process.env.NEXTGAME_WEB_URL ?? 'http://localhost:8091';

/** The Umami website id baked into app/+html.tsx for nextgame. */
export const UMAMI_WEBSITE_ID = 'b3560325-b595-41d7-989a-1db789edfb50';

export const HTTP_OK = 200;
export const HTTP_NOT_FOUND = 404;
export const MIN_TARGET_PX = 44;
export const MOBILE_VIEWPORT = { width: 400, height: 860 };

interface EnLocale {
  seo: { titles: Record<string, string> };
  privacy: { updated: string; analyticsHeading: string };
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

/** Real routes a signed-out visitor can open directly. */
export const REAL_ROUTES: SpaRoute[] = [
  { name: 'landing', path: '/', title: title('landing'), screenTestId: TestIds.LANDING_SCREEN },
  { name: 'privacy', path: '/privacy', title: title('privacy'), screenTestId: TestIds.PRIVACY_SCREEN },
  { name: 'age', path: '/age', title: title('age'), screenTestId: TestIds.AGE_SCREEN },
];

export const NOT_FOUND_ROUTE: SpaRoute = {
  name: 'not-found',
  path: '/definitely-not-a-route',
  title: title('notFound'),
  screenTestId: TestIds.NOT_FOUND_SCREEN,
};

export const POLICY_VERSION_TEXT = en.privacy.updated.replace('{{p1}}', POLICY_VERSION);
export const ANALYTICS_HEADING = en.privacy.analyticsHeading;

export { ANALYTICS_HOST, TestIds };

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { createQuestionerApiHelper, QuestionerApiHelper } from '../../../helpers/questioner-admin.js';
import {
  createAnonymousWebContext,
  getFramingHeaders,
  type PublicQuestionerContents,
} from '../../../helpers/questioner/publicRespondent.js';

/**
 * E2E — Erevna survey EMBED framing @questioner
 *
 * Proves the embeddable survey route is iframe-able from external sites AND that no
 * correct answer leaks through the embed view. The embed route + its framing headers
 * are served by the erevna-web nginx (NOT the questioner API):
 *
 *   GET {EREVNA_BASE_URL}/public/survey/embed/{externalId}
 *
 * Asserts:
 *   1. 200 OK (the SPA shell is served for the embed deep link).
 *   2. X-Frame-Options does NOT block framing (cleared by the nginx
 *      `location /public/survey/` carve-out — not SAMEORIGIN / DENY).
 *   3. Content-Security-Policy allows `frame-ancestors *`.
 *   4. The served HTML shell carries no leaked answer payload.
 *
 * NOTE: this requires a real nginx-served erevna-web build (the carve-out lives in
 * `erevna-web/nginx.conf`). When `EREVNA_BASE_URL` is unset, the test SKIPS rather
 * than asserting against the wrong host. If the BFF/Traefik ingress ever injects a
 * SAMEORIGIN frame header on `/public/survey/embed/*`, assertion (2) catches it.
 */

const HTTP_OK = 200;
const Q_RATING = 'q-rating';
const RATING_CORRECT_VALUE = 'excellent';

/** Template contents WITH a correct answer set — must NOT leak through the embed shell. */
function buildOwnerContents(): PublicQuestionerContents {
  return {
    questions: [
      {
        id: Q_RATING,
        name: 'Overall Rating',
        type: 3, // Radio
        options: [
          { label: 'Excellent', value: 'excellent' },
          { label: 'Good', value: 'good' },
        ],
        page: 1,
        order: 1,
        isRequired: true,
        answer: { stringValue: RATING_CORRECT_VALUE },
      },
    ],
  };
}

test.describe.serial('Survey embed framing @questioner', () => {
  let owner: QuestionerApiHelper;
  let web: APIRequestContext | null = null;
  let activeTemplateId: string | null = null;
  const templateName = `Survey Embed Framing E2E ${Date.now()}`;

  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    web = await createAnonymousWebContext();
    if (web === null) return; // EREVNA_BASE_URL unset → tests below skip.

    const { admin } = getProjectUsers(testInfo.project.name);
    owner = createQuestionerApiHelper();
    await owner.login(admin.username, admin.password);
    await owner.deactivateAllTemplates();
    activeTemplateId = await owner.createTemplate(templateName, 'E2E embed framing template');
    await owner.updateTemplate(activeTemplateId, templateName, 'E2E embed framing template', buildOwnerContents(), true);
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(60_000);
    await web?.dispose().catch(() => {});
    if (owner && activeTemplateId) await owner.cleanup(activeTemplateId, []).catch(() => {});
  });

  test('embed route is served with iframe-friendly framing headers and no answer leak', async () => {
    test.skip(web === null, 'EREVNA_BASE_URL not set — frontend framing host unavailable');
    expect(activeTemplateId, 'owner setup must have produced a template externalId').toBeTruthy();

    const result = await getFramingHeaders(
      web as APIRequestContext,
      `/public/survey/embed/${activeTemplateId as string}`,
    );

    expect(result.status, `expected 200 for the embed route, got ${result.status}`).toBe(HTTP_OK);

    // X-Frame-Options must NOT block framing (carve-out clears it).
    const xfo = (result.xFrameOptions ?? '').toUpperCase();
    expect(xfo, `X-Frame-Options must not block framing, got "${result.xFrameOptions}"`).not.toContain('SAMEORIGIN');
    expect(xfo).not.toContain('DENY');

    // CSP must permit any frame ancestor.
    const csp = (result.contentSecurityPolicy ?? '').toLowerCase();
    expect(csp, `CSP must allow frame-ancestors *, got "${result.contentSecurityPolicy}"`).toContain('frame-ancestors *');

    // The served shell must not embed the correct answer value.
    expect(result.bodyText.includes(RATING_CORRECT_VALUE), 'correct answer must not leak in the embed shell').toBe(false);
  });
});

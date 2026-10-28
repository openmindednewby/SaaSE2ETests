import { test, expect, type APIRequestContext } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
  type ApiTenantHandle,
} from '../../helpers/kefi/kefiApiTenant.js';
import { probeDynamicLandingRender } from '../../helpers/kefi/kefiDynamicLandingProbe.js';
import { publicTenantPath } from '../../helpers/kefi/kefiLandingPeopleFixture.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { decodeHtml, loadKucyRecreate, matrixRows, missingFrom } from '../../helpers/kefi/kucyRecreate.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 120;
const data = loadKucyRecreate();
const rows = matrixRows(data);

let admin: KefiAdminClient;
let tenant: ApiTenantHandle | undefined;
let page = '';
let saved: Record<string, unknown[] | object | null> = {};

async function readPublicLanding(request: APIRequestContext, slug: string): Promise<typeof saved> {
  const resp = await request.get(`${getKefiUrls().apiUrl}${publicTenantPath(slug)}`);
  expect(resp.status(), `public GET ${publicTenantPath(slug)}`).toBe(200);
  return ((await resp.json()) as { landing: typeof saved }).landing;
}

test.describe('KEFI-RECREATE-1 KUCY recreated by API replay on a throwaway tenant', () => {
  test.skip(!isRemoteTarget(), 'runs against a deployed kefi stack');
  test.skip(!masterAdminAvailable(), 'needs KEYCLOAK_MASTER_ADMIN_* to mint the e2c- tenant');

  test.beforeAll(async ({ request }) => {
    admin = new KefiAdminClient();
    tenant = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: 'FULL',
      passLabel: 'Full Pass',
      priceEur: 30,
    });
    await admin.putLandingConfig({ ...tenant.ownerCreds, dto: data.landing });
    const published = await admin.publishLanding(tenant.ownerCreds);
    const terminal = await admin.pollPublishStatus({ ...tenant.ownerCreds, jobName: published.jobName });
    expect(terminal.status, `publish job ${published.jobName}`).toBe('Succeeded');
    const probe = await probeDynamicLandingRender({ slug: tenant.slug, requiredMarkers: [data.config.branding.name] });
    page = decodeHtml(await (await request.get(probe.url)).text());
    saved = await readPublicLanding(request, tenant.slug);
  });

  test.afterAll(async () => {
    if (tenant) await teardownApiTenant(tenant, admin);
  });

  test('CM-API saved config read back publicly, keeps passes, add-ons, book, posters and footer', () => {
    const expected = {
      passes: data.config.passes.length,
      addOns: data.config.addOns.length,
      posters: data.config.posters.length,
      footerLinks: data.config.footer.links.length,
      bookTitle: data.config.book.title,
    };

    const actual = {
      passes: (saved.passes as unknown[] | null)?.length ?? 0,
      addOns: (saved.addOns as unknown[] | null)?.length ?? 0,
      posters: (saved.posters as unknown[] | null)?.length ?? 0,
      footerLinks: ((saved.footer as { links?: unknown[] } | null)?.links ?? []).length,
      bookTitle: (saved.book as { title?: string } | null)?.title,
    };

    expect(actual, 'public landing echoes the kucy-recreate fields').toEqual(expected);
  });

  for (const row of rows) {
    test(`${row.id} published page with the ${row.scenario}, renders every data-file value`, () => {
      const expected = row.expected;

      const missing = missingFrom(page, expected);

      expect(missing, `${row.id} values absent from /t/${tenant?.slug ?? '?'}/`).toEqual([]);
    });
  }
});

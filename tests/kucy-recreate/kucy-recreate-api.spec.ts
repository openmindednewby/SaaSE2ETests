import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { decodeHtml, loadKucyRecreate, loadLandingSource, matrixRows, missingFrom } from '../../helpers/kefi/kucyRecreate.js';
import { isRemoteTarget } from '../../helpers/target.js';

const EVENT_DAYS_AHEAD = 120;
const PUBLISH_POLL_TIMEOUT_MS = 900_000;
const PUBLISH_BUILD_TIMEOUT_MS = 1_200_000;
const PAGE_FETCH_ATTEMPT_MS = 60_000;
const PAGE_FETCH_RETRY_INTERVALS_MS = [5_000, 15_000, 30_000];
const TEARDOWN_404_TIMEOUT_MS = 120_000;
const SNAPSHOT_FILE = join(tmpdir(), `kucy-recreate-api-${process.ppid}.json`);
const data = loadKucyRecreate();
const rows = matrixRows(data);

let admin: KefiAdminClient;
let tenant: ApiTenantHandle | undefined;
let page = '';
let saved: Record<string, unknown[] | object | null> = {};
let slug = '?';

async function readPublicLanding(request: APIRequestContext, tenantSlug: string): Promise<typeof saved> {
  const resp = await request.get(`${getKefiUrls().apiUrl}${publicTenantPath(tenantSlug)}`, { timeout: PAGE_FETCH_ATTEMPT_MS });
  expect(resp.status(), `public GET ${publicTenantPath(tenantSlug)}`).toBe(200);
  return ((await resp.json()) as { landing: typeof saved }).landing;
}

async function fetchPublished(request: APIRequestContext, url: string): Promise<string> {
  let html = '';
  await expect(async () => {
    const resp = await request.get(url, { timeout: PAGE_FETCH_ATTEMPT_MS });
    expect(resp.status(), `GET ${url}`).toBe(200);
    html = await resp.text();
  }).toPass({ intervals: PAGE_FETCH_RETRY_INTERVALS_MS, timeout: PUBLISH_POLL_TIMEOUT_MS });
  return decodeHtml(html);
}

test.describe('KEFI-RECREATE-1 data file landing equals the KUCY tenant landing-config.json', () => {
  test('CM-SRC kucy-recreate.json landing compared with kefi-landings landing-config.json, is identical', () => {
    const source = loadLandingSource();

    const copy = data.landing;

    expect(source.landing, `${source.path} readable (set KEFI_LANDINGS_DIR to the kefi-landings clone)`).not.toBeNull();
    expect(copy, `helpers/kefi/data/kucy-recreate.json landing diverged from ${source.path}`).toEqual(source.landing);
  });
});

test.describe('KEFI-RECREATE-1 KUCY recreated by API replay on a throwaway tenant', () => {
  test.skip(!isRemoteTarget(), 'runs against a deployed kefi stack');
  test.skip(!masterAdminAvailable(), 'needs KEYCLOAK_MASTER_ADMIN_* to mint the e2c- tenant');

  test.beforeAll(async ({ request }) => {
    test.setTimeout(PUBLISH_BUILD_TIMEOUT_MS);
    if (existsSync(SNAPSHOT_FILE)) {
      ({ page, saved, slug } = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf-8')) as { page: string; saved: typeof saved; slug: string });
      return;
    }
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
    const terminal = await admin.pollPublishStatus({ ...tenant.ownerCreds, jobName: published.jobName, timeoutMs: PUBLISH_POLL_TIMEOUT_MS });
    expect(terminal.status, `publish job ${published.jobName}`).toBe('Succeeded');
    const probe = await probeDynamicLandingRender({ slug: tenant.slug, requiredMarkers: [data.config.branding.name] });
    page = await fetchPublished(request, probe.url);
    saved = await readPublicLanding(request, tenant.slug);
    slug = tenant.slug;
    writeFileSync(SNAPSHOT_FILE, JSON.stringify({ page, saved, slug }));
  });

  test.afterAll(async ({ request }) => {
    if (!tenant) return;
    const gone = tenant;
    tenant = undefined;
    await teardownApiTenant(gone, admin);
    await expect.poll(async () => (await request.get(`${getKefiUrls().apiUrl}${publicTenantPath(gone.slug)}`)).status(), {
      message: `public GET ${publicTenantPath(gone.slug)} after teardown`,
      timeout: TEARDOWN_404_TIMEOUT_MS,
    }).toBe(404);
  });

  test('CM-API saved config read back publicly, keeps passes, add-ons, book, posters and footer', () => {
    const expected = {
      passes: data.config.passes.length,
      addOns: data.config.addOns.length,
      posters: data.config.posters.length,
      footerLinks: data.config.footer?.links.length ?? 0,
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
      test.skip(row.expected.length === 0, `landing-config.json source gap: ${row.sourceGap ?? 'no values'}`);
      if (row.sourceGap) test.info().annotations.push({ type: 'source-gap', description: row.sourceGap });
      const expected = row.expected;

      const missing = missingFrom(page, expected);

      expect(missing, `${row.id} values absent from /t/${slug}/`).toEqual([]);
    });
  }
});

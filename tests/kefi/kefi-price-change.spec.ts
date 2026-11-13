import { test, expect, type APIRequestContext } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiPassPricingClient, type OrganizerPass } from '../../helpers/kefi/kefiPassPricingClient.js';
import { KefiPassEditClient } from '../../helpers/kefi/kefiPassEditClient.js';
import {
  FIXTURE_TENANT_SKIP_REASON,
  fixtureTenantAvailable,
  getKefiFixtureTenant,
  type KefiFixtureTenant,
} from '../../helpers/kefi/kefiFixtureTenant.js';
import {
  addWindow,
  bakedPriceTag,
  getPriceTimeline,
  isCurrent,
  listWindows,
  replaceCurrentWindow,
  restoreWindow,
  timelinePrice,
  type PassRef,
  utcNowIso,
  type WindowReplacement,
} from '../../helpers/kefi/kefiPriceWindowClient.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';

const HOUR_MS = 60 * 60 * 1000;
const PUBLISH_TIMEOUT_MS = 300_000;
const PUBLISH_TEST_TIMEOUT_MS = 900_000;
const SHARED_PASS_CODE = 'CLASS';
const SHARED_TIER_NAME = 'Workshop Pass';
const PRICE_STEP_EUR = 2;
const SWITCH_DELAY_MS = 15_000;
const SWITCH_WAIT_MS = 90_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_PUBLISHES = 2;

test.describe.configure({ mode: 'serial' });

test.describe('KEFI-PRICE-E2E-1 organizer price change reaching the public page', () => {
  test.skip(!isRemoteTarget(), 'Targets the deployed Kefi API and the published e2e landing');
  test.skip(!fixtureTenantAvailable(), FIXTURE_TENANT_SKIP_REASON);

  const admin = new KefiAdminClient();
  let tenant: KefiFixtureTenant;
  let bearer = '';

  test.beforeAll(async () => {
    tenant = getKefiFixtureTenant();
    bearer = await admin.getTenantOwnerBearer({ email: tenant.organizerEmail, password: tenant.organizerPassword });
  });

  const owner = (): { ownerEmail: string; ownerPassword: string } => ({ ownerEmail: tenant.organizerEmail, ownerPassword: tenant.organizerPassword });

  async function sharedPass(): Promise<OrganizerPass> {
    const list = await new KefiPassPricingClient().getOrganizerPasses(bearer, tenant.eventExternalId);
    const pass = (list.data as OrganizerPass[]).find((p) => p.code === SHARED_PASS_CODE);
    if (!pass) throw new Error(`fixture pass ${SHARED_PASS_CODE} missing on the e2e event`);
    return pass;
  }

  async function currentWindowOf(request: APIRequestContext, ref: PassRef) {
    const current = (await listWindows(request, ref)).find((w) => isCurrent(w, Date.now()));
    if (!current) throw new Error(`pass ${ref.passExternalId} has no current price window`);
    return current;
  }

  test('AC-PRICE-1 with the current window closed and a new one opened from now, the price timeline returns the new price', async ({ request }) => {
    const code = `PRC${Date.now().toString(36).toUpperCase()}`;
    const oldPriceEur = 10;
    const newPriceEur = 14;
    const created = await new KefiPassEditClient().createPass(bearer, tenant.eventExternalId, { code, label: `Price e2e ${code}`, priceEur: oldPriceEur });
    expect(created.status, `create dedicated pass ${code}`).toBe(201);
    const ref: PassRef = { bearer, eventExternalId: tenant.eventExternalId, passExternalId: (created.data as { externalId: string }).externalId };
    try {
      const current = await addWindow(request, ref, {
        priceEur: oldPriceEur, effectiveFromUtc: new Date(Date.now() - HOUR_MS).toISOString(), effectiveUntilUtc: null, label: null, minPaidCount: null,
      });

      await replaceCurrentWindow(request, ref, current, newPriceEur);

      const timeline = await getPriceTimeline(request, tenant.slug);
      expect(timeline.eventExternalId, 'the timeline is the fixture event').toBe(tenant.eventExternalId);
      expect(timelinePrice(timeline, code), `timeline price of ${code} after the window change`).toBe(newPriceEur);
    } finally {
      const removed = await request.delete(
        `${getKefiUrls().apiUrl}/api/v1/organizer/events/${tenant.eventExternalId}/passes/${ref.passExternalId}`,
        { headers: { Authorization: `Bearer ${bearer}` } },
      );
      expect(removed.status(), `dedicated pass ${code} removed`).toBeLessThan(300);
    }
  });

  test('AC-PRICE-2 with a window change not yet published, the page keeps the old price-tag while the timeline shows the new price', async ({ request }) => {
    const pass = await sharedPass();
    const ref: PassRef = { bearer, eventExternalId: tenant.eventExternalId, passExternalId: pass.externalId };
    const current = await currentWindowOf(request, ref);
    const bakedBefore = await bakedPriceTag(request, tenant.siteUrl, SHARED_TIER_NAME);
    const newPriceEur = current.priceEur + PRICE_STEP_EUR;
    expect(bakedBefore, `the baked ${SHARED_TIER_NAME} price-tag before the change`).toBe(`€${current.priceEur}`);
    let replacement: WindowReplacement | undefined;
    try {
      replacement = await replaceCurrentWindow(request, ref, current, newPriceEur);

      const timeline = await getPriceTimeline(request, tenant.slug);
      const bakedAfter = await bakedPriceTag(request, tenant.siteUrl, SHARED_TIER_NAME);
      expect(timelinePrice(timeline, SHARED_PASS_CODE), 'the timeline shows the new price at once').toBe(newPriceEur);
      expect(bakedAfter, 'the page keeps the old price until a publish').toBe(bakedBefore);
    } finally {
      if (replacement) await restoreWindow(request, ref, replacement);
    }
  });

  test('AC-PRICE-3 AC-PRICE-4 AC-PRICE-5 with a started window published, the price-tag shows its price; with a future window published, it keeps the current price', async ({ request }) => {
    test.skip(process.env.KEFI_PRICE_E2E_PUBLISH !== '1', 'Two publishes per run rebuild every tenant site; opt in with KEFI_PRICE_E2E_PUBLISH=1');
    test.setTimeout(PUBLISH_TEST_TIMEOUT_MS);
    const pass = await sharedPass();
    const ref: PassRef = { bearer, eventExternalId: tenant.eventExternalId, passExternalId: pass.externalId };
    const current = await currentWindowOf(request, ref);
    const startedPriceEur = current.priceEur + PRICE_STEP_EUR;
    const futurePriceEur = current.priceEur + 2 * PRICE_STEP_EUR;
    let started: WindowReplacement | undefined = await replaceCurrentWindow(request, ref, current, startedPriceEur, utcNowIso(SWITCH_DELAY_MS));
    let future: WindowReplacement | undefined;
    let publishes = 0;
    const publish = async (): Promise<void> => {
      publishes += 1;
      expect(publishes, 'at most two publishes per run').toBeLessThanOrEqual(MAX_PUBLISHES);
      const job = await admin.publishLanding(owner());
      await admin.pollPublishStatus({ ...owner(), jobName: job.jobName, timeoutMs: PUBLISH_TIMEOUT_MS });
    };
    try {
      await expect.poll(async () => timelinePrice(await getPriceTimeline(request, tenant.slug), SHARED_PASS_CODE), {
        message: 'the window scheduled in the future has started', timeout: SWITCH_WAIT_MS,
      }).toBe(startedPriceEur);

      await publish();
      const bakedAfterStart = await bakedPriceTag(request, tenant.siteUrl, SHARED_TIER_NAME);
      await restoreWindow(request, ref, started);
      started = undefined;
      future = await replaceCurrentWindow(request, ref, current, futurePriceEur, utcNowIso(DAY_MS));
      await publish();
      const bakedBeforeFuture = await bakedPriceTag(request, tenant.siteUrl, SHARED_TIER_NAME);

      expect.soft(bakedAfterStart, 'AC-PRICE-3 AC-PRICE-5 a started window is baked by the publish').toBe(`€${startedPriceEur}`);
      expect.soft(bakedBeforeFuture, 'AC-PRICE-4 a window that has not started is not baked').toBe(`€${current.priceEur}`);
    } finally {
      if (future) await restoreWindow(request, ref, future);
      if (started) {
        await restoreWindow(request, ref, started);
        if (publishes > 0) await publish();
      }
    }
  });
});

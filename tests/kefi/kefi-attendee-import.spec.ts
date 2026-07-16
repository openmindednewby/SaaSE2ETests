/**
 * Kefi organizer attendee bulk-import E2E (task #276 gap #3, feature #265).
 *
 * How an organizer migrating from a spreadsheet (exactly UBB's onboarding) loads
 * their attendee list. The `attendeeImport` parse/dedup code shipped untested
 * through E2E — a regression here silently loses attendees. This drives the real
 * import endpoint through BOTH intake modes the product supports on the one route:
 *
 *   1. JSON  — an `attendees[]` array (2 paid + 1 expected) → created 3, skip 0.
 *   2. CSV   — a multipart file whose rows include a DUPLICATE of a JSON email
 *              (dedup-by-email → skipped) and an INVALID pass code (→ per-row
 *              error) alongside one fresh paid row → created 1, skipped 1, error 1.
 *   3. OBSERVE — the platform-admin canary snapshot shows the paid rows as `Paid`,
 *              the expected row as `Expected`, and the errored email absent.
 *   4. WALLS  — an empty batch → 400; an unknown event id → 404.
 *
 * Pure `@api` (no browser): master-admin provisions the Pro tenant + owner + event
 * headlessly. Master-admin-only (staging); prod self-skips. WRITE + COMPILE-
 * verified — the authed legs run post-F1-kefi.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiLifecycleClient } from '../../helpers/kefi/kefiLifecycleClient.js';
import {
  KefiImportClient,
  type AttendeeImportResult,
} from '../../helpers/kefi/kefiImportClient.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
} from '../../helpers/kefi/kefiApiTenant.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 90;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 30 } as const;
const PAID_EUR = 30;

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

const STATUS_PAID = 'Paid';
const STATUS_EXPECTED = 'Expected';
const RANDOM_EVENT_ID = '00000000-0000-0000-0000-000000000000';

/** Narrow an import response to the summary DTO after asserting its status. */
function asResult(resp: { status: number; data: unknown }): AttendeeImportResult {
  return resp.data as AttendeeImportResult;
}

test.describe('Kefi organizer attendee bulk-import (#265)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi attendee-import E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@api imports paid + expected attendees from JSON and CSV, dedups by email, reports errors', async () => {
    test.skip(
      !masterAdminAvailable(),
      'The @api tier provisions a Pro tenant + owner + event via KC master-admin; only staging carries those creds.',
    );
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const imports = new KefiImportClient();

    const handle = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: PASS.code,
      passLabel: PASS.label,
      priceEur: PASS.priceEur,
    });
    test.info().annotations.push({ type: 'canaryId', description: handle.ctx.canaryId });
    const local = handle.ctx.email.split('@')[0];
    const domain = handle.ctx.email.split('@')[1];
    const emailA = `${local}-imp-a@${domain}`;
    const emailB = `${local}-imp-b@${domain}`;
    const emailC = `${local}-imp-c@${domain}`;
    const emailD = `${local}-imp-d@${domain}`;
    const emailE = `${local}-imp-e@${domain}`;

    try {
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: handle.ownerCreds.ownerEmail,
        password: handle.ownerCreds.ownerPassword,
      });

      // ── 1. JSON import — 2 paid + 1 expected ───────────────────────────
      const jsonResult = await imports.importJson({
        bearer: ownerBearer,
        eventExternalId: handle.eventExternalId,
        attendees: [
          { name: 'Paid', surname: 'Aye', email: emailA, phone: '+35799000501', passCode: PASS.code, paidEur: PAID_EUR, paymentMethod: 'cash' },
          { name: 'Paid', surname: 'Bee', email: emailB, phone: '+35799000502', passCode: PASS.code, paidEur: PAID_EUR, paymentMethod: 'card' },
          { name: 'Expected', surname: 'Cee', email: emailC, phone: '+35799000503', passCode: PASS.code, expected: true },
        ],
      });
      expect(jsonResult.status, 'JSON import → 200').toBe(HTTP_OK);
      const json = asResult(jsonResult);
      expect(json.created, 'JSON created 3 attendees').toBe(3);
      expect(json.skipped, 'JSON skipped none').toBe(0);
      expect(json.errorCount, 'JSON had no row errors').toBe(0);

      // ── 2. CSV import — 1 fresh paid, 1 duplicate email, 1 bad pass code ──
      const csv = [
        'name,surname,email,phone,passCode,paidEur,paymentMethod',
        `Paid,Dee,${emailD},+35799000504,${PASS.code},${PAID_EUR},revolut`,
        `Dup,Aye,${emailA},+35799000505,${PASS.code},${PAID_EUR},cash`,
        `Bad,Pass,${emailE},+35799000506,NOTAPASS,${PAID_EUR},cash`,
      ].join('\n');
      const csvResult = await imports.importCsv({
        bearer: ownerBearer,
        eventExternalId: handle.eventExternalId,
        csv,
        skipDuplicates: true,
      });
      expect(csvResult.status, 'CSV import → 200').toBe(HTTP_OK);
      const csvSummary = asResult(csvResult);
      expect(csvSummary.created, 'CSV created the one fresh paid row').toBe(1);
      expect(csvSummary.skipped, 'CSV skipped the duplicate email').toBe(1);
      expect(csvSummary.errorCount, 'CSV reported the invalid pass-code row').toBe(1);
      expect(csvSummary.errors[0]?.row, 'the error row is row 3 (data, header excluded)').toBe(3);

      // ── 3. Observe — paid rows Paid, expected row Expected, bad row absent ──
      const snapshot = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      const statusOf = (email: string): string | undefined =>
        snapshot.attendees.find((a) => a.email === email)?.status;
      expect(statusOf(emailA), 'imported paid A is Paid').toBe(STATUS_PAID);
      expect(statusOf(emailB), 'imported paid B is Paid').toBe(STATUS_PAID);
      expect(statusOf(emailD), 'CSV paid D is Paid').toBe(STATUS_PAID);
      expect(statusOf(emailC), 'imported expected C is Expected').toBe(STATUS_EXPECTED);
      expect(
        snapshot.attendees.some((a) => a.email === emailE),
        'the invalid-pass row created no attendee',
      ).toBe(false);
      expect(
        snapshot.attendees.filter((a) => a.email === emailA).length,
        'the duplicate email did not create a second attendee row',
      ).toBe(1);

      // ── 4. Walls — empty batch → 400, unknown event → 404 ──────────────
      expect(
        (await imports.importJson({ bearer: ownerBearer, eventExternalId: handle.eventExternalId, attendees: [] })).status,
        'an empty import batch → 400',
      ).toBe(HTTP_BAD_REQUEST);
      expect(
        (await imports.importJson({
          bearer: ownerBearer, eventExternalId: RANDOM_EVENT_ID,
          attendees: [{ name: 'Nobody', passCode: PASS.code }],
        })).status,
        'import to an event outside the tenant → 404',
      ).toBe(HTTP_NOT_FOUND);
    } finally {
      await teardownApiTenant(handle, admin);
    }
  });
});

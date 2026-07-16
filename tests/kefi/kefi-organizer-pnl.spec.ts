/**
 * Kefi organizer dashboard / P&L E2E (task #276 gap #4).
 *
 * The headline organizer value prop (`app/organizer/index.tsx` → GET
 * /organizer/events/{id}): server-computed gross/net, paid-vs-expected counts,
 * costs, payouts. A wrong/zero total, or a crash on a Draft event, is a
 * credibility-killer in a demo — and had ZERO E2E coverage.
 *
 * The P&L math keys off the attendee `Paid`/`Expected` BOOLEANS (RecordPayment /
 * MarkExpected), NOT the Status enum — so a canary-seeded "Paid" attendee is
 * financially invisible. The bulk-import path DOES call RecordPayment, so this
 * spec seeds genuinely-paid attendees via import, then asserts the numbers:
 *
 *   1. import 2 paid (€30 each) + 1 expected → GET the P&L →
 *      paidAttendeeCount 2, expectedAttendeeCount 1, gross €60, the FULL pass line
 *      shows 2 @ €60, net > 0 (and ≤ gross), zero costs.
 *   2. a fresh Draft event (no attendees) → GET the P&L → 200 with safe ZEROS
 *      (no crash — the audit's Draft-event guard case).
 *   3. walls — unknown event id → 404, no bearer → 401.
 *
 * Pure `@api`. Master-admin-only (staging); prod self-skips. WRITE + COMPILE-
 * verified — the authed legs run post-F1-kefi.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiEventClient } from '../../helpers/kefi/kefiEventClient.js';
import { KefiImportClient } from '../../helpers/kefi/kefiImportClient.js';
import {
  KefiOrganizerClient,
  type OrganizerEventDto,
} from '../../helpers/kefi/kefiOrganizerClient.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
} from '../../helpers/kefi/kefiApiTenant.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 30 } as const;
const PAID_EUR = 30;
const EXPECTED_GROSS = 60;
const EXPECTED_PAID_COUNT = 2;
const EXPECTED_EXPECTED_COUNT = 1;

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const RANDOM_EVENT_ID = '00000000-0000-0000-0000-000000000000';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Narrow an organizer-event response to the DTO after asserting its status. */
function asDto(resp: { status: number; data: unknown }): OrganizerEventDto {
  return resp.data as OrganizerEventDto;
}

test.describe('Kefi organizer dashboard / P&L (#276)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi organizer-P&L E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@api P&L reflects paid + expected attendees and returns safe zeros for a Draft event', async () => {
    test.skip(
      !masterAdminAvailable(),
      'The @api tier provisions a Pro tenant + owner + event via KC master-admin; only staging carries those creds.',
    );
    const admin = new KefiAdminClient();
    const imports = new KefiImportClient();
    const events = new KefiEventClient(admin);
    const organizer = new KefiOrganizerClient();

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

    try {
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: handle.ownerCreds.ownerEmail,
        password: handle.ownerCreds.ownerPassword,
      });

      // ── Seed genuinely-paid attendees via import (import calls RecordPayment) ──
      const seededImport = await imports.importJson({
        bearer: ownerBearer,
        eventExternalId: handle.eventExternalId,
        attendees: [
          { name: 'Paid', surname: 'One', email: `${local}-pnl-a@${domain}`, phone: '+35799000601', passCode: PASS.code, paidEur: PAID_EUR, paymentMethod: 'cash' },
          { name: 'Paid', surname: 'Two', email: `${local}-pnl-b@${domain}`, phone: '+35799000602', passCode: PASS.code, paidEur: PAID_EUR, paymentMethod: 'card' },
          { name: 'Expected', surname: 'Three', email: `${local}-pnl-c@${domain}`, phone: '+35799000603', passCode: PASS.code, expected: true },
        ],
      });
      expect(seededImport.status, 'import seed → 200').toBe(HTTP_OK);

      // ── 1. P&L reflects the paid + expected attendees ──────────────────
      const pnlResp = await organizer.getOrganizerEvent(ownerBearer, handle.eventExternalId);
      expect(pnlResp.status, 'GET organizer event → 200').toBe(HTTP_OK);
      const { pnl } = asDto(pnlResp);
      expect(pnl.paidAttendeeCount, 'paid attendee count').toBe(EXPECTED_PAID_COUNT);
      expect(pnl.expectedAttendeeCount, 'expected attendee count').toBe(EXPECTED_EXPECTED_COUNT);
      expect(pnl.grossPassRevenueEur, 'gross pass revenue = 2 × €30').toBe(EXPECTED_GROSS);
      const fullLine = pnl.passLines.find((l) => l.passCode === PASS.code);
      expect(fullLine, 'a P&L line exists for the FULL pass').toBeDefined();
      expect(fullLine!.paidCount, 'FULL pass line paid count').toBe(EXPECTED_PAID_COUNT);
      expect(fullLine!.grossRevenueEur, 'FULL pass line gross').toBe(EXPECTED_GROSS);
      // No costs/crew/payouts seedable via canary → net is the whole organizer share.
      expect(pnl.fixedCostTotalEur, 'no fixed costs seeded').toBe(0);
      expect(pnl.crewCostTotalEur, 'no crew costs seeded').toBe(0);
      expect(pnl.netProfitEur, 'net profit is positive').toBeGreaterThan(0);
      expect(pnl.netProfitEur, 'net profit does not exceed gross with zero costs').toBeLessThanOrEqual(EXPECTED_GROSS);

      // ── 2. A fresh Draft event returns safe zeros (no crash) ───────────
      const draft = await events.createMyEvent({
        ...handle.ownerCreds,
        name: `${handle.ctx.slugPrefix}Draft Event`,
        dateIso: toIsoDate(new Date(Date.now() + EVENT_DAYS_AHEAD * MS_PER_DAY)),
        venue: `${handle.ctx.slugPrefix}Draft Venue`,
      });
      const draftPnl = await organizer.getOrganizerEvent(ownerBearer, draft.externalId);
      expect(draftPnl.status, 'Draft event P&L → 200 (no crash)').toBe(HTTP_OK);
      const draftDto = asDto(draftPnl);
      expect(draftDto.pnl.paidAttendeeCount, 'Draft event has no paid attendees').toBe(0);
      expect(draftDto.pnl.grossPassRevenueEur, 'Draft event gross is zero').toBe(0);
      expect(draftDto.pnl.netProfitEur, 'Draft event net is zero').toBe(0);

      // ── 3. Walls — unknown event → 404, no bearer → 401 ────────────────
      expect(
        (await organizer.getOrganizerEvent(ownerBearer, RANDOM_EVENT_ID)).status,
        'unknown event id → 404',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await organizer.getOrganizerEvent('', handle.eventExternalId)).status,
        'no-bearer P&L → 401',
      ).toBe(HTTP_UNAUTHORIZED);
    } finally {
      await teardownApiTenant(handle, admin);
    }
  });
});

/**
 * Kefi ORGANIZER check-in / undo — the write the crew roster row issues
 * (KEFI-REF-1 "Per-promoter referral links + labelled promoter row actions", step 5).
 *
 * kefi-web's `useRosterCheckIn` → `useCheckInAttendee` → `checkInAttendee` POSTs
 * `{ checkedIn }` to `/organizer/events/{e}/attendees/{a}/check-in`. Its unit tests
 * mock the transport, so until this spec nothing proved the SERVER accepts that
 * shape. The request here is built by `KefiOrganizerCheckInClient`, which mirrors
 * the client's URL + body builder (see that file for the exact mapping).
 *
 * Asserts: check-in flips `checkedIn` true (response AND a fresh ledger re-read);
 * undo flips it false; repeating either direction is an idempotent 200 that
 * changes nothing (`SetCheckedIn` is a no-op in the target state).
 *
 * STAGING ONLY: provisions a canary tenant via KC master-admin and tears it down.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiDoorLedgerClient, type LedgerView } from '../../helpers/kefi/kefiDoorLedgerClient.js';
import { KefiImportClient } from '../../helpers/kefi/kefiImportClient.js';
import { KefiLifecycleClient } from '../../helpers/kefi/kefiLifecycleClient.js';
import { KefiOrganizerCheckInClient } from '../../helpers/kefi/kefiOrganizerCheckInClient.js';
import { provisionApiTenantWithEvent, teardownApiTenant } from '../../helpers/kefi/kefiApiTenant.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 90;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 30 } as const;
const HTTP_OK = 200;

type CheckInBody = { checkedIn: boolean; attendeeExternalId: string };

test.describe('Kefi organizer check-in / undo (roster row write)', () => {
  test.skip(!isRemoteTarget(), 'Provisions a canary tenant on a deployed environment');

  test('@api check-in flips true, undo flips false, repeats are idempotent', async () => {
    test.skip(!masterAdminAvailable(), 'Needs KC master-admin (staging only)');
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const imports = new KefiImportClient();
    const ledger = new KefiDoorLedgerClient();
    const checkIns = new KefiOrganizerCheckInClient();

    const handle = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: PASS.code,
      passLabel: PASS.label,
      priceEur: PASS.priceEur,
    });
    test.info().annotations.push({ type: 'canaryId', description: handle.ctx.canaryId });
    const [local, domain] = handle.ctx.email.split('@');
    const email = `${local}-chk@${domain}`;

    try {
      const bearer = await admin.getTenantOwnerBearer({
        email: handle.ownerCreds.ownerEmail,
        password: handle.ownerCreds.ownerPassword,
      });
      const seed = await imports.importJson({
        bearer,
        eventExternalId: handle.eventExternalId,
        attendees: [
          { name: 'Staff', surname: 'Pass', email, phone: '+35799000602', passCode: PASS.code, paidEur: 0, paymentMethod: 'cash' },
        ],
      });
      expect(seed.status, 'seed import → 200').toBe(HTTP_OK);
      const seeded = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      const attendeeExternalId = seeded.attendees.find((a) => a.email === email)?.externalId;
      expect(attendeeExternalId, 'the seeded attendee exists').toBeDefined();

      const write = (checkedIn: boolean) =>
        checkIns.setCheckedIn({ bearer, eventExternalId: handle.eventExternalId, attendeeExternalId: attendeeExternalId!, checkedIn });
      const reread = async (): Promise<boolean | undefined> => {
        const resp = await ledger.getLedgerByBearer(handle.slug, bearer, handle.eventExternalId);
        expect(resp.status, 'ledger re-read → 200').toBe(HTTP_OK);
        return (resp.data as LedgerView).attendees.find((a) => a.attendeeExternalId === attendeeExternalId)?.checkedIn;
      };

      expect(await reread(), 'a new attendee starts un-checked-in').toBe(false);

      const steps: Array<{ target: boolean; why: string }> = [
        { target: true, why: 'check-in' },
        { target: true, why: 'repeat check-in (idempotent)' },
        { target: false, why: 'undo' },
        { target: false, why: 'repeat undo (idempotent)' },
      ];
      for (const step of steps) {
        const resp = await write(step.target);
        expect(resp.status, `${step.why}: the client-shaped write is accepted`).toBe(HTTP_OK);
        const body = resp.data as CheckInBody;
        expect(body.attendeeExternalId, `${step.why}: response keys the same attendee`).toBe(attendeeExternalId);
        expect(body.checkedIn, `${step.why}: response reports the target state`).toBe(step.target);
        expect(await reread(), `${step.why}: a fresh server read confirms it persisted`).toBe(step.target);
      }
    } finally {
      await teardownApiTenant(handle, admin);
    }
  });
});

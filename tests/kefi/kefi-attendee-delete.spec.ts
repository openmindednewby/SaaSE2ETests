/**
 * Kefi organizer hard-delete-attendee E2E (feature #278).
 *
 * How an organizer undoes a mistaken / typo import: they import an attendee, then
 * delete that one row. Unlike GDPR erasure (which anonymises in place and keeps
 * the money), the delete removes the row outright — so it must vanish from the
 * event. This drives the real delete endpoint end-to-end:
 *
 *   1. SEED    — import ONE paid attendee via the JSON import path (reused
 *                {@link KefiImportClient}); confirm it exists in the canary snapshot
 *                and capture its externalId.
 *   2. DELETE  — DELETE the attendee → 204; re-read the snapshot → the row is GONE.
 *   3. WALLS   — deleting an unknown attendee id → 404; deleting on an event
 *                outside the tenant → 404.
 *
 * Pure `@api` (no browser): master-admin provisions the Pro tenant + owner + event
 * headlessly. Master-admin-only (staging); prod self-skips. WRITE + COMPILE-
 * verified — the authed legs run post-deploy of the #278 kefi-api.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { KefiLifecycleClient } from '../../helpers/kefi/kefiLifecycleClient.js';
import { KefiImportClient } from '../../helpers/kefi/kefiImportClient.js';
import { KefiAttendeeDeleteClient } from '../../helpers/kefi/kefiAttendeeDeleteClient.js';
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
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;

const RANDOM_EVENT_ID = '00000000-0000-0000-0000-000000000000';
const RANDOM_ATTENDEE_ID = '11111111-1111-1111-1111-111111111111';

test.describe('Kefi organizer hard-delete-attendee (#278)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi attendee-delete E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@api imports an attendee then deletes it; the row is gone; walls return 404', async () => {
    test.skip(
      !masterAdminAvailable(),
      'The @api tier provisions a Pro tenant + owner + event via KC master-admin; only staging carries those creds.',
    );
    const admin = new KefiAdminClient();
    const lifecycle = new KefiLifecycleClient(admin);
    const imports = new KefiImportClient();
    const deletes = new KefiAttendeeDeleteClient();

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
    const email = `${local}-del-a@${domain}`;

    try {
      const ownerBearer = await admin.getTenantOwnerBearer({
        email: handle.ownerCreds.ownerEmail,
        password: handle.ownerCreds.ownerPassword,
      });

      // ── 1. Seed — import one paid attendee, capture its externalId ──────
      const importResult = await imports.importJson({
        bearer: ownerBearer,
        eventExternalId: handle.eventExternalId,
        attendees: [
          { name: 'Typo', surname: 'Row', email, phone: '+35799000601', passCode: PASS.code, paidEur: PAID_EUR, paymentMethod: 'cash' },
        ],
      });
      expect(importResult.status, 'seed import → 200').toBe(HTTP_OK);

      const seeded = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      const target = seeded.attendees.find((a) => a.email === email);
      expect(target, 'the imported attendee exists before delete').toBeDefined();
      const attendeeExternalId = target!.externalId;

      // ── 2. Delete — 204, then the row is gone from the snapshot ─────────
      const deleteResult = await deletes.deleteAttendee({
        bearer: ownerBearer,
        eventExternalId: handle.eventExternalId,
        attendeeExternalId,
      });
      expect(deleteResult.status, 'delete → 204 No Content').toBe(HTTP_NO_CONTENT);

      const afterDelete = await lifecycle.getCanaryAttendees(handle.ctx.canaryId);
      expect(
        afterDelete.attendees.some((a) => a.externalId === attendeeExternalId),
        'the deleted attendee is gone from the event',
      ).toBe(false);
      expect(
        afterDelete.attendees.some((a) => a.email === email),
        'no residual row with the deleted attendee email remains',
      ).toBe(false);

      // ── 3. Walls — unknown attendee → 404; event outside tenant → 404 ──
      expect(
        (await deletes.deleteAttendee({
          bearer: ownerBearer,
          eventExternalId: handle.eventExternalId,
          attendeeExternalId: RANDOM_ATTENDEE_ID,
        })).status,
        'deleting an unknown attendee → 404',
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (await deletes.deleteAttendee({
          bearer: ownerBearer,
          eventExternalId: RANDOM_EVENT_ID,
          attendeeExternalId: RANDOM_ATTENDEE_ID,
        })).status,
        'deleting on an event outside the tenant → 404',
      ).toBe(HTTP_NOT_FOUND);
    } finally {
      await teardownApiTenant(handle, admin);
    }
  });
});

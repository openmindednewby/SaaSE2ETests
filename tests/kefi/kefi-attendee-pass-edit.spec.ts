/**
 * Kefi organizer pass edit — price lock tier label, ticket-code prefix swap on a
 * pass change, and the Guest -> comp conversion.
 *
 *   AC-04  PUT price-lock {lockedPriceEur:30, tierLabel:"Early bird"} on an unpaid
 *          CLASS attendee -> list shows 30, locked, priceTierLabel
 *          "CLASS · Early bird €30"; with no tierLabel the label is "€30".
 *   AC-05  PUT attendee passCode FULL -> CLASS swaps the ticket-code prefix and
 *          keeps the name + number part, the ticket token and the external id.
 *   AC-08  convert-to-comps turns imported Guest rows into comp attendees on a
 *          GUEST pass (ticket code + token), skips a guest whose name matches an
 *          existing attendee, and a second run converts 0.
 *
 * Pure @api. Each run provisions its own canary tenant + event (master-admin,
 * staging only) and sweeps it in afterAll; it never reads or writes a real
 * tenant's event. The requests are hand-built by kefiPassEditClient, so the
 * kefi-web client's write shape is not observed here.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
  type ApiTenantHandle,
} from '../../helpers/kefi/kefiApiTenant.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import {
  KefiPassEditClient,
  type PassEditAttendee,
} from '../../helpers/kefi/kefiPassEditClient.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 60;
const FULL = { code: 'FULL', label: 'Full Pass', priceEur: 50 } as const;
const CLASS = { code: 'CLASS', label: 'Class Pass', priceEur: 35 } as const;
const GUEST_PASS_CODE = 'GUEST';
const LOCKED_EUR = 30;
const TIER_LABEL = 'Early bird';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

function uniqueTag(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

test.describe('Kefi organizer pass edit (KEFI-ATTENDEE-PASS-EDIT-1)', () => {
  test.skip(!isRemoteTarget(), 'targets a deployed Kefi API (staging)');
  test.skip(
    !masterAdminAvailable(),
    'provisions its own canary tenant via KC master-admin; only staging carries those creds',
  );

  const admin = new KefiAdminClient();
  const client = new KefiPassEditClient();
  let handle: ApiTenantHandle | undefined;
  let bearer = '';

  function eventId(): string {
    if (!handle) throw new Error('canary tenant was not provisioned');
    return handle.eventExternalId;
  }

  async function addAttendee(passCode: string, surname: string): Promise<PassEditAttendee> {
    const resp = await client.createAttendee(bearer, eventId(), { name: 'Pass', surname, passCode });
    expect(resp.status, `organizer add-attendee on ${passCode} is accepted`).toBe(HTTP_CREATED);
    return resp.data;
  }

  async function readAttendee(externalId: string): Promise<PassEditAttendee> {
    const row = (await client.listAttendees(bearer, eventId())).find((a) => a.externalId === externalId);
    if (!row) throw new Error(`attendee ${externalId} missing from the organizer list`);
    return row;
  }

  test.beforeAll(async () => {
    handle = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: FULL.code,
      passLabel: FULL.label,
      priceEur: FULL.priceEur,
    });
    bearer = await admin.getTenantOwnerBearer({
      email: handle.ownerCreds.ownerEmail,
      password: handle.ownerCreds.ownerPassword,
    });
    const classPass = await client.createPass(bearer, handle.eventExternalId, CLASS);
    expect(classPass.status, 'the CLASS pass is created on the canary event').toBe(HTTP_CREATED);
  });

  test.afterAll(async () => {
    if (handle) await teardownApiTenant(handle, admin);
  });

  test('AC-04 @api price lock with tierLabel sets priceTierLabel; without it the label is the amount', async () => {
    test.info().annotations.push({
      type: 'canary',
      description: `canaryId=${handle?.ctx.canaryId} tenantId=${handle?.tenantId} eventId=${eventId()}`,
    });
    const labelled = await addAttendee(CLASS.code, `Lock${uniqueTag()}`);
    const lock = await client.lockPrice(bearer, eventId(), labelled.externalId, {
      lockedPriceEur: LOCKED_EUR,
      tierLabel: TIER_LABEL,
    });
    expect(lock.status, 'price-lock with a tierLabel is accepted').toBe(HTTP_OK);

    const row = await readAttendee(labelled.externalId);
    expect(row.priceLocked, 'the row is locked').toBe(true);
    expect(row.lockedPriceEur, 'the locked amount is stored').toBe(LOCKED_EUR);
    expect(row.amountDueEur, 'the list reports the locked amount as due').toBe(LOCKED_EUR);
    expect(row.priceTierLabel, 'the label names pass, tier and price').toBe(
      `${CLASS.code} · ${TIER_LABEL} €${LOCKED_EUR}`,
    );

    const plain = await addAttendee(CLASS.code, `Plain${uniqueTag()}`);
    const plainLock = await client.lockPrice(bearer, eventId(), plain.externalId, {
      lockedPriceEur: LOCKED_EUR,
    });
    expect(plainLock.status, 'price-lock without a tierLabel is accepted').toBe(HTTP_OK);
    expect(
      (await readAttendee(plain.externalId)).priceTierLabel,
      'an omitted tierLabel keeps the amount-only label',
    ).toBe(`€${LOCKED_EUR}`);
  });

  test('AC-05 @api a pass change swaps the ticket-code prefix and keeps name, number and token', async () => {
    // The create response carries no ticketToken; the baseline is the stored row.
    const before = await readAttendee((await addAttendee(FULL.code, `Swap${uniqueTag()}`)).externalId);
    const oldRef = before.paymentReference ?? '';
    expect(oldRef.startsWith(`${FULL.code}-`), `a FULL attendee gets a FULL- code (got "${oldRef}")`).toBe(true);

    const change = await client.changePass(bearer, eventId(), before, CLASS.code);
    expect(change.status, 'the pass change FULL -> CLASS is accepted').toBe(HTTP_OK);

    const after = await readAttendee(before.externalId);
    expect(after.passCode, 'the attendee is now on CLASS').toBe(CLASS.code);
    expect(after.paymentReference, 'only the prefix changes; name and number are kept').toBe(
      `${CLASS.code}-${oldRef.slice(FULL.code.length + 1)}`,
    );
    expect(after.ticketToken, 'the ticket token is unchanged, so sent links keep working').toBe(
      before.ticketToken,
    );
    expect(after.externalId, 'the attendee identity is unchanged').toBe(before.externalId);
  });

  test('AC-08 @api convert-to-comps mints GUEST comps, skips a same-name attendee, and a re-run converts 0', async () => {
    if (!handle) throw new Error('canary tenant was not provisioned');
    const tag = uniqueTag();
    const guestNames = [`Ana Guest${tag}`, `Ben Guest${tag}`, `Dup Guest${tag}`];
    const graph = await client.exportEventGraph(bearer, handle.eventExternalId);
    graph.guests = guestNames.map((name) => ({
      name, instagramHandle: null, phone: null, email: null, note: 'Guest',
    }));
    const imported = await client.importEventGraph(await admin.getBearer(), handle.tenantId, graph);
    expect(imported.status, 'the platform import rebuilds the event with its Guest rows').toBe(HTTP_CREATED);
    const ev = imported.data.eventExternalId;
    test.info().annotations.push({ type: 'importedEvent', description: `importedEventId=${ev}` });

    const dup = await client.createAttendee(bearer, ev, { name: 'Dup', surname: `Guest${tag}`, passCode: FULL.code });
    expect(dup.status, 'the same-name attendee is added before conversion').toBe(HTTP_CREATED);

    const first = await client.convertGuestsToComps(bearer, ev);
    expect(first.status, 'the first conversion succeeds').toBe(HTTP_OK);
    expect(first.data, 'two guests convert; the same-name guest is skipped').toEqual({ converted: 2, skipped: 1 });

    const comps = (await client.listAttendees(bearer, ev)).filter((a) => a.passCode === GUEST_PASS_CODE);
    expect(comps.map((c) => c.name).sort(), 'one comp per non-duplicate guest').toEqual(guestNames.slice(0, 2));
    for (const comp of comps) {
      expect(comp.paymentReference ?? '', `${comp.name} has a GUEST ticket code with a G number`).toMatch(/^GUEST-.+-G\d+$/);
      expect(comp.ticketToken ?? '', `${comp.name} has a ticket token`).not.toBe('');
    }

    const second = await client.convertGuestsToComps(bearer, ev);
    expect(second.status, 'the re-run succeeds').toBe(HTTP_OK);
    expect(second.data.converted, 'a re-run creates nothing').toBe(0);
    const compsAfter = (await client.listAttendees(bearer, ev)).filter((a) => a.passCode === GUEST_PASS_CODE);
    expect(compsAfter.length, 'no duplicate comps after the re-run').toBe(comps.length);
  });
});

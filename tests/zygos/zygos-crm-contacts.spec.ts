// Zygos CRM contacts @api (FINREG C-01) — the customer directory: create, read, edit, archive and
// filter a contact, all through the BFF against the deployed console.
//
// A contact is tenant reference data, not a financial record — so unlike a PaymentInstruction it CAN
// change state (Active⇄Inactive) and be edited. The seed-independence rule still applies: the tenant
// accumulates rows, so no test asserts on a global count or "the first row". Every test tags its own
// contacts with a run-unique token and filters by that exact tag, so accumulated rows cannot move an
// assertion.
//
// 🔴 Runs as a FIXTURE user, not the demo user. Every test here creates the rows it reads, so it
// never needed the demo seed — it used the demo login only because that was a convenient real
// account. That convenience meant CI wrote contacts into the PUBLIC demo tenant every night, and put
// the run at the mercy of anyone holding the published credentials. Same coverage, own tenant.
import { expect, test } from '@playwright/test';

import { ModulesApi } from './zygos-console-modules.js';
import { ZYGOS_USERS, bodyJson, bodyText, zygosTag } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { ContactDto, CreateContactBody, Paged } from './zygos-console-modules.js';
import type { ZygosSession } from './zygos-session.js';

const SKIP_REASON = 'Zygos console unreachable or fixture user rejected';
const DEFAULT_PAGE_SIZE = 50;
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

test.describe('Zygos CRM contacts @zygos-api @api', () => {
  let session: ZygosSession | null;
  let api: ModulesApi;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    session = await loginAs(ZYGOS_USERS.MAKER_A);
    if (session) api = new ModulesApi(session);
  });

  test.beforeEach(() => {
    test.skip(!session, SKIP_REASON);
  });

  /** Create a contact as the fixture user; assert it lands Active. Returns its DTO. */
  async function createContact(body: CreateContactBody): Promise<ContactDto> {
    const res = await api.createContact(body);
    expect(res.status(), `create contact failed: ${await bodyText(res)}`).toBe(201);
    const dto = (await res.json()) as ContactDto;
    expect(dto.status, 'a new contact is born Active').toBe('Active');
    expect(dto.externalId, 'a created contact carries a server-assigned id').toBeTruthy();
    return dto;
  }

  test('GET /contacts returns a well-formed paged envelope of tenant-scoped rows', async () => {
    const res = await api.listContacts();
    const body = await bodyJson<Paged<ContactDto>>(res);
    expect(res.status(), `list failed: ${await bodyText(res)}`).toBe(200);
    expect(Array.isArray(body?.items), 'items must be an array').toBe(true);
    expect(body?.page).toBe(1);
    expect(body?.pageSize, 'the documented default page size').toBe(DEFAULT_PAGE_SIZE);
    expect(body?.totalCount ?? -1).toBeGreaterThanOrEqual(0);

    // The row shape the client depends on — assert on any row that happens to be present without
    // pinning identity (the list is shared and unordered from this test's point of view).
    for (const row of body?.items ?? []) {
      expect(typeof row.displayName, 'every row carries a displayName').toBe('string');
      expect(['Person', 'Organization']).toContain(row.kind);
      expect(['Active', 'Inactive']).toContain(row.status);
    }
  });

  test('pageSize above the cap is rejected with 400', async () => {
    const res = await api.listContacts('?pageSize=101');
    expect(res.status(), `over-cap pageSize must be 400; body: ${await bodyText(res)}`).toBe(400);
  });

  test('a created contact loads on the detail endpoint; a bogus id is 404', async () => {
    const tag = zygosTag('contact-detail');
    const created = await createContact({ displayName: `Ada ${tag}`, kind: 'Person', email: 'ada@example.com' });

    const res = await api.getContact(created.externalId);
    const detail = await bodyJson<ContactDto>(res);
    expect(res.status(), `get contact failed: ${await bodyText(res)}`).toBe(200);
    expect(detail?.externalId).toBe(created.externalId);
    expect(detail?.displayName).toBe(`Ada ${tag}`);
    expect(detail?.kind).toBe('Person');

    const missing = await api.getContact(UNKNOWN_ID);
    expect(missing.status(), `an unknown contact must be 404; body: ${await bodyText(missing)}`).toBe(404);
  });

  test('creating a contact with no displayName is rejected with 400', async () => {
    // FastEndpoints binds the FluentValidation Validator<T>, so a missing display name is a clean 400
    // — never a 500 from the handler. Sent as a loose object so TS does not stop the bad request.
    const res = await api.createContact({ kind: 'Person', email: 'noname@example.com' });
    expect(res.status(), `a missing displayName must be 400; body: ${await bodyText(res)}`).toBe(400);
  });

  test('PUT /contacts/{id} edits a contact and the change round-trips', async () => {
    const tag = zygosTag('contact-edit');
    const created = await createContact({ displayName: `Before ${tag}`, kind: 'Organization' });

    const put = await api.updateContact(created.externalId, {
      displayName: `After ${tag}`,
      email: 'after@example.com',
      phone: '+35799000000',
    });
    const updated = await bodyJson<ContactDto>(put);
    expect(put.status(), `edit failed: ${await bodyText(put)}`).toBe(200);
    expect(updated?.displayName, 'the edit is reflected in the response').toBe(`After ${tag}`);
    expect(updated?.email).toBe('after@example.com');
    // The kind is fixed at creation — an edit cannot change it.
    expect(updated?.kind, 'kind is immutable after creation').toBe('Organization');

    const reloaded = await bodyJson<ContactDto>(await api.getContact(created.externalId));
    expect(reloaded?.displayName, 'the edit persisted, not just echoed').toBe(`After ${tag}`);
  });

  test('deactivate archives a contact and reactivate restores it', async () => {
    const tag = zygosTag('contact-lifecycle');
    const created = await createContact({ displayName: `Cycle ${tag}`, kind: 'Person' });

    const deactivated = await api.deactivateContact(created.externalId);
    const inactive = await bodyJson<ContactDto>(deactivated);
    expect(deactivated.status(), `deactivate failed: ${await bodyText(deactivated)}`).toBe(200);
    expect(inactive?.status, 'deactivate marks the contact Inactive').toBe('Inactive');

    const reactivated = await api.reactivateContact(created.externalId);
    const active = await bodyJson<ContactDto>(reactivated);
    expect(reactivated.status(), `reactivate failed: ${await bodyText(reactivated)}`).toBe(200);
    expect(active?.status, 'reactivate marks the contact Active again').toBe('Active');

    const missing = await api.deactivateContact(UNKNOWN_ID);
    expect(missing.status(), `deactivating an unknown contact must be 404; body: ${await bodyText(missing)}`).toBe(404);
  });

  test('kind, status, search and tag filters each return the right subset', async () => {
    // A run-unique tag makes this test's rows uniquely findable in a shared, accumulating tenant.
    // The token also goes in each displayName so the free-text Search leg has something to match.
    const tag = zygosTag('contact-filter');
    const person = await createContact({ displayName: `Person ${tag}`, kind: 'Person', tags: [tag] });
    const org = await createContact({ displayName: `Org ${tag}`, kind: 'Organization', tags: [tag] });

    // ── Tag: exact array containment ⇒ exactly the two rows this test created. ──
    const byTag = await bodyJson<Paged<ContactDto>>(await api.listContacts(`?tag=${encodeURIComponent(tag)}`));
    const tagIds = (byTag?.items ?? []).map((c) => c.externalId).sort();
    expect(tagIds, 'the tag filter returns exactly this run’s two tagged contacts').toEqual(
      [person.externalId, org.externalId].sort(),
    );

    // ── Tag + Kind: the Person only. ──
    const byKind = await bodyJson<Paged<ContactDto>>(
      await api.listContacts(`?tag=${encodeURIComponent(tag)}&kind=Person`),
    );
    expect(byKind?.items.map((c) => c.externalId), 'tag+kind narrows to the single Person').toEqual([
      person.externalId,
    ]);

    // ── Search: ILIKE on displayName ⇒ both rows (both names contain the token). ──
    const bySearch = await bodyJson<Paged<ContactDto>>(await api.listContacts(`?search=${encodeURIComponent(tag)}`));
    expect((bySearch?.items ?? []).map((c) => c.externalId).sort(), 'search matches both display names').toEqual(
      [person.externalId, org.externalId].sort(),
    );

    // ── Tag + Status: archive the org, then each status filter returns exactly one of the pair. ──
    await api.deactivateContact(org.externalId);
    const inactive = await bodyJson<Paged<ContactDto>>(
      await api.listContacts(`?tag=${encodeURIComponent(tag)}&status=Inactive`),
    );
    expect(inactive?.items.map((c) => c.externalId), 'status=Inactive returns the archived org only').toEqual([
      org.externalId,
    ]);
    const stillActive = await bodyJson<Paged<ContactDto>>(
      await api.listContacts(`?tag=${encodeURIComponent(tag)}&status=Active`),
    );
    expect(stillActive?.items.map((c) => c.externalId), 'status=Active returns the person only').toEqual([
      person.externalId,
    ]);
  });
});

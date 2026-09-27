/**
 * KEFI-PEOPLE-1 "Organizer people editor" — acceptance tests, PUT side.
 * Spec: BaseClient/docs/Tasks/IN_PROGRESS/KEFI-PEOPLE-1-organizer-people-editor.md → "Acceptance list (G5)".
 *
 * Locked (acceptance-lock). One test per AC; AC-04/06 and the upload half of AC-09 live in
 * `kefi-landing-upload.spec.ts`.
 *
 * Rig: two disposable `e2c-` canary tenants (never csdf) + organizer / non-organizer users,
 * provisioned server-side via KC master-admin. Kefi is prod-only (STG-SSD-1d), so the owner
 * approved running this against PROD on throwaway tenants: run with `E2E_TARGET=prod` and
 * `KEYCLOAK_MASTER_ADMIN_*` exported for the run (never committed); without them it skips.
 *
 * AC-07 is tagged `@publish`: a publish rebuilds the shared kefi-landings deployment (every
 * tenant site), so run it deliberately and alone (`--grep @publish`), never in a loop.
 *
 * NOT COVERED: every request here is hand-assembled, so this tests the server
 * contract only — the kefi-web editor's own request shape is pinned separately by
 * `expectJsonWriteShape` in kefi-web, and the editor UI by a visual-qa sighting (AC-08).
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import {
  bearerFor,
  groupByKey,
  makeTestImages,
  publicLanding,
  putLandingPatch,
  uploadImage,
  type Person,
} from '../../helpers/kefi/kefiLandingPeopleApi.js';
import {
  provisionLandingPeopleFixture,
  teardownLandingPeopleFixture,
  type LandingPeopleFixture,
} from '../../helpers/kefi/kefiLandingPeopleFixture.js';
import { tenantPathUrl } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';

const PUBLISH_TEST_TIMEOUT_MS = 600_000;
const PUBLISH_POLL_TIMEOUT_MS = 480_000;

test.describe.configure({ mode: 'serial' });

test.describe('KEFI-PEOPLE-1 organizer people editor — landing-config PUT', () => {
  test.skip(!isRemoteTarget(), 'Kefi people E2E targets a remote cluster (prod since STG-SSD-1d); local stack not wired');
  test.skip(!masterAdminAvailable(), 'Provisions tenants + role users via KC master-admin; export KEYCLOAK_MASTER_ADMIN_* for the run.');

  const admin = new KefiAdminClient();
  let fx: LandingPeopleFixture | undefined;

  const must = (): LandingPeopleFixture => {
    if (!fx) throw new Error('fixture not provisioned');
    return fx;
  };

  test.beforeAll(async () => {
    fx = await provisionLandingPeopleFixture(admin);
  });

  test.afterAll(async () => {
    await teardownLandingPeopleFixture(fx, admin);
  });

  // Given an organizer token and tenant A with a group,
  // When PUT KEFI_LANDING_CONFIG_PATH with a new person (name, role, topic, socials),
  // Then GET publicTenantPath(slug) returns that person with those fields.
  test('AC-01 organizer adds a person to a group and the public API returns it', async ({ request }) => {
    const { tenantA, organizerA } = must();
    const bearer = await bearerFor(admin, organizerA);
    const person: Person = {
      id: 'ac01-maria',
      name: 'Maria Ac01',
      role: 'Bachata Artist · Cyprus',
      topic: 'Bachata',
      socials: [{ id: 'ig', kind: 'instagram', label: 'Instagram', url: 'https://instagram.com/maria.ac01' }],
    };
    const put = await putLandingPatch(request, bearer, { performerGroups: [{ key: 'teachers', title: 'Teachers', performers: [person] }] });
    expect(put.status(), `organizer PUT should be 200: ${await put.text()}`).toBe(200);

    const got = groupByKey(await publicLanding(request, tenantA.slug), 'teachers')?.performers ?? [];
    expect(got.map((p) => p.id), 'public API should list exactly the new person').toEqual(['ac01-maria']);
    expect(got[0], 'public person should carry name, role and topic').toMatchObject({ name: person.name, role: person.role, topic: person.topic });
    expect(got[0].socials, 'public person should carry the social link').toEqual([expect.objectContaining({ kind: 'instagram', url: 'https://instagram.com/maria.ac01' })]);
  });

  // Given a group with 3 people,
  // When the organizer PUTs them reordered, one edited, one deleted,
  // Then the public API has the same order and edits, and the deleted person is gone.
  test('AC-02 organizer edits, deletes and reorders people and the public order matches', async ({ request }) => {
    const { tenantA, organizerA } = must();
    const bearer = await bearerFor(admin, organizerA);
    const three: Person[] = [
      { id: 'p1', name: 'One Ac02' },
      { id: 'p2', name: 'Two Ac02' },
      { id: 'p3', name: 'Three Ac02' },
    ];
    const seed = await putLandingPatch(request, bearer, { performerGroups: [{ key: 'teachers', title: 'Teachers', performers: three }] });
    expect(seed.status(), `seed PUT should be 200: ${await seed.text()}`).toBe(200);

    const edited: Person[] = [{ id: 'p3', name: 'Three Ac02' }, { id: 'p1', name: 'One Ac02 Edited', topic: 'Kizomba' }];
    const put = await putLandingPatch(request, bearer, { performerGroups: [{ key: 'teachers', title: 'Teachers', performers: edited }] });
    expect(put.status(), `reorder/edit/delete PUT should be 200: ${await put.text()}`).toBe(200);

    const got = groupByKey(await publicLanding(request, tenantA.slug), 'teachers')?.performers ?? [];
    expect(got.map((p) => p.id), 'public order should be p3, p1 with p2 deleted').toEqual(['p3', 'p1']);
    expect(got[1], 'the edit to p1 should be public').toMatchObject({ name: 'One Ac02 Edited', topic: 'Kizomba' });
  });

  // Given an organizer,
  // When PUT with a new group (e.g. "Ambassadors"), a renamed group and a removed group,
  // Then the public API reflects all three.
  test('AC-03 organizer adds, renames and removes a group', async ({ request }) => {
    const { tenantA, organizerA } = must();
    const bearer = await bearerFor(admin, organizerA);
    const one = (id: string): Person[] => [{ id, name: `Person ${id}` }];
    const seed = await putLandingPatch(request, bearer, {
      performerGroups: [
        { key: 'teachers', title: 'Teachers', performers: one('t1') },
        { key: 'djs', title: 'DJs', performers: one('d1') },
        { key: 'media', title: 'Media', performers: one('m1') },
      ],
    });
    expect(seed.status(), `seed PUT should be 200: ${await seed.text()}`).toBe(200);

    const put = await putLandingPatch(request, bearer, {
      performerGroups: [
        { key: 'teachers', title: 'Artists', performers: one('t1') },
        { key: 'djs', title: 'DJs', performers: one('d1') },
        { key: 'ambassadors', title: 'Ambassadors', performers: one('a1') },
      ],
    });
    expect(put.status(), `group add/rename/remove PUT should be 200: ${await put.text()}`).toBe(200);

    const landing = await publicLanding(request, tenantA.slug);
    expect(landing.performerGroups?.map((g) => g.key), 'media removed, ambassadors added').toEqual(['teachers', 'djs', 'ambassadors']);
    expect(groupByKey(landing, 'teachers')?.title, 'teachers renamed to Artists').toBe('Artists');
    expect(groupByKey(landing, 'ambassadors')?.performers.map((p) => p.id), 'new group carries its person').toEqual(['a1']);
  });

  // Given a person,
  // When PUT photoPosition inside the bounds (x,y within ±60, scale 0.5–3), then outside them,
  // Then inside round-trips through the public API; outside returns 400 from the validator.
  test('AC-05 photoPosition inside the bounds round-trips, outside them is rejected with 400', async ({ request }) => {
    const { tenantA, organizerA } = must();
    const bearer = await bearerFor(admin, organizerA);
    const withPos = (photoPosition: { x: number; y: number; scale: number }): Parameters<typeof putLandingPatch>[2] => ({
      performerGroups: [{ key: 'teachers', title: 'Teachers', performers: [{ id: 'framed', name: 'Framed Ac05', photoPosition }] }],
    });
    const inside = { x: -60, y: 35, scale: 2.5 };
    const ok = await putLandingPatch(request, bearer, withPos(inside));
    expect(ok.status(), `in-bounds PUT should be 200: ${await ok.text()}`).toBe(200);
    const got = groupByKey(await publicLanding(request, tenantA.slug), 'teachers')?.performers[0];
    expect(got?.photoPosition, 'in-bounds photoPosition should round-trip').toEqual(inside);

    for (const outside of [{ x: 61, y: 0, scale: 1 }, { x: 0, y: -61, scale: 1 }, { x: 0, y: 0, scale: 3.5 }, { x: 0, y: 0, scale: 0.4 }]) {
      const bad = await putLandingPatch(request, bearer, withPos(outside));
      expect(bad.status(), `out-of-bounds ${JSON.stringify(outside)} should be 400`).toBe(400);
    }
    const after = groupByKey(await publicLanding(request, tenantA.slug), 'teachers')?.performers[0];
    expect(after?.photoPosition, 'a rejected PUT must not change the saved framing').toEqual(inside);
  });

  // Given a person saved with an uploaded photo (KEFI_LANDING_UPLOAD_PATH),
  // When POST publish and wait for Succeeded (admin.publishLanding + poll),
  // Then the live tenant HTML (tenantPathUrl(slug) = app.kefi.dloizides.com/t/<slug>/, owner
  // decision in the spec doc, BaseClient 531e0c0: an admin-provisioned tenant has no subdomain
  // Ingress) contains the person's name and photo URL.
  test('AC-07 after publish the live tenant site shows the person with the uploaded photo', { tag: '@publish' }, async ({ request, browser }) => {
    test.setTimeout(PUBLISH_TEST_TIMEOUT_MS);
    const { tenantA, organizerA } = must();
    const bearer = await bearerFor(admin, organizerA);
    const { png } = await makeTestImages(browser);
    const up = await uploadImage(request, bearer, png);
    expect(up.status(), `photo upload should be 201: ${await up.text()}`).toBe(201);
    const { url } = (await up.json()) as { url: string };

    const name = `Published Ac07 ${tenantA.ctx.canaryId}`;
    const put = await putLandingPatch(request, bearer, {
      performerGroups: [{ key: 'teachers', title: 'Teachers', performers: [{ id: 'pub', name, photoUrl: url }] }],
    });
    expect(put.status(), `PUT with the photo should be 200: ${await put.text()}`).toBe(200);

    const creds = { ownerEmail: organizerA.username, ownerPassword: organizerA.password };
    const job = await admin.publishLanding(creds);
    const done = await admin.pollPublishStatus({ ...creds, jobName: job.jobName, timeoutMs: PUBLISH_POLL_TIMEOUT_MS });
    expect(done.status, 'publish job should succeed').toBe('Succeeded');

    await expect(async () => {
      const html = await (await request.get(`${tenantPathUrl(tenantA.slug)}?cb=${Date.now()}`)).text();
      expect(html, 'live tenant HTML should contain the person name').toContain(name);
      expect(html, 'live tenant HTML should contain the uploaded photo URL').toContain(url);
    }).toPass({ timeout: 120_000 });
  });

  // Given the non-organizer of tenant A, and the organizer of tenant B,
  // When each PUTs people,
  // Then the non-organizer gets 403, and tenant B's write never changes tenant A's public people.
  test('AC-09 a non-organizer or another tenant\'s organizer cannot write tenant A\'s people', async ({ request }) => {
    const { tenantA, tenantB, nonOrganizerA, organizerB } = must();
    const before = (await publicLanding(request, tenantA.slug)).performerGroups;
    const intrusion = { performerGroups: [{ key: 'teachers', title: 'Hijacked', performers: [{ id: 'x', name: 'Intruder Ac09' }] }] };

    const denied = await putLandingPatch(request, await bearerFor(admin, nonOrganizerA), intrusion);
    expect(denied.status(), 'a non-organizer (ambassador) PUT must be 403').toBe(403);

    const other = await putLandingPatch(request, await bearerFor(admin, organizerB), intrusion);
    expect(other.status(), `tenant B organizer writes its OWN tenant: ${await other.text()}`).toBe(200);
    expect(groupByKey(await publicLanding(request, tenantB.slug), 'teachers')?.title, 'the write landed on tenant B').toBe('Hijacked');
    expect((await publicLanding(request, tenantA.slug)).performerGroups, 'tenant A people must be unchanged').toEqual(before);
  });
});

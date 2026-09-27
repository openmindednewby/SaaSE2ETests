/**
 * KEFI-PEOPLE-1 "Organizer people editor" — acceptance tests, upload side.
 * Spec: BaseClient/docs/Tasks/IN_PROGRESS/KEFI-PEOPLE-1-organizer-people-editor.md → "Acceptance list (G5)".
 *
 * Locked (acceptance-lock). Endpoint: `KEFI_LANDING_UPLOAD_PATH`
 * (POST /api/v1/admin/landing-config/images, kefi-api b183c0d, shared
 * Dloizides.Content.Upload.AspNetCore proxying to ContentService).
 *
 * Rig: two disposable `e2c-` canary tenants (never csdf) + organizer / non-organizer users,
 * provisioned server-side via KC master-admin. Runs against PROD on throwaway tenants (owner
 * decision, kefi is prod-only): `E2E_TARGET=prod` with `KEYCLOAK_MASTER_ADMIN_*` exported.
 *
 * NOT COVERED: requests are hand-assembled, so the kefi-web upload client's own
 * multipart shape is not observed here.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import {
  bearerFor,
  makeTestImages,
  pngKeepsAlpha,
  publicLanding,
  putLandingPatch,
  uploadImage,
  type ImageFile,
} from '../../helpers/kefi/kefiLandingPeopleApi.js';
import {
  KEFI_LANDING_UPLOAD_PATH,
  provisionLandingPeopleFixture,
  teardownLandingPeopleFixture,
  type LandingPeopleFixture,
} from '../../helpers/kefi/kefiLandingPeopleFixture.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

test.describe('KEFI-PEOPLE-1 organizer people editor — landing image upload', () => {
  test.skip(!isRemoteTarget(), 'Kefi upload E2E targets a remote cluster (prod since STG-SSD-1d); local stack not wired');
  test.skip(!masterAdminAvailable(), 'Provisions tenants + role users via KC master-admin; export KEYCLOAK_MASTER_ADMIN_* for the run.');

  const admin = new KefiAdminClient();
  let fx: LandingPeopleFixture | undefined;
  let images: { png: ImageFile; jpeg: ImageFile } | undefined;

  const must = (): LandingPeopleFixture => {
    if (!fx) throw new Error('fixture not provisioned');
    return fx;
  };
  const img = (): { png: ImageFile; jpeg: ImageFile } => {
    if (!images) throw new Error('test images not generated');
    return images;
  };

  test.beforeAll(async ({ browser }) => {
    images = await makeTestImages(browser);
    fx = await provisionLandingPeopleFixture(admin);
  });

  test.afterAll(async () => {
    await teardownLandingPeopleFixture(fx, admin);
  });

  // Given the organizer of tenant A and a transparent PNG,
  // When POST it (multipart) to KEFI_LANDING_UPLOAD_PATH,
  // Then 201 with an https URL; GET of that URL returns an image whose PNG alpha survives;
  // and a non-image file is rejected with 415 or 400.
  test('AC-04 organizer uploads a person photo and gets an https URL that keeps PNG transparency', async ({ request }) => {
    const bearer = await bearerFor(admin, must().organizerA);
    expect(pngKeepsAlpha(img().png.buffer), 'precondition: the test PNG itself carries alpha').toBe(true);

    const up = await uploadImage(request, bearer, img().png);
    expect(up.status(), `upload to ${KEFI_LANDING_UPLOAD_PATH} should be 201: ${await up.text()}`).toBe(201);
    const { url } = (await up.json()) as { url: string };
    expect(url, 'upload should return an https URL').toMatch(/^https:\/\//);

    const served = await request.get(url);
    expect(served.status(), `GET ${url} should be 200`).toBe(200);
    expect(served.headers()['content-type'], 'served file should be an image').toMatch(/^image\//);
    expect(pngKeepsAlpha(await served.body()), 'served PNG should keep its alpha channel').toBe(true);

    const notImage = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image at all') };
    const rejected = await uploadImage(request, bearer, notImage);
    expect([400, 415], `a non-image upload should be 400 or 415, got ${rejected.status()}`).toContain(rejected.status());
    const disguised = await uploadImage(request, bearer, { ...notImage, name: 'fake.png', mimeType: 'image/png' });
    expect([400, 415], `text disguised as image/png should be 400 or 415, got ${disguised.status()}`).toContain(disguised.status());
  });

  // Given the organizer of tenant A and a flier jpeg,
  // When it is uploaded to KEFI_LANDING_UPLOAD_PATH and posters are PUT reordered,
  // Then the poster imageUrl is the uploaded URL and the public API order matches.
  test('AC-06 organizer uploads a poster flier and reorders posters', async ({ request }) => {
    const { tenantA, organizerA } = must();
    const bearer = await bearerFor(admin, organizerA);
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      const up = await uploadImage(request, bearer, { ...img().jpeg, name: `flier-${i}.jpg` });
      expect(up.status(), `flier upload ${i} should be 201: ${await up.text()}`).toBe(201);
      urls.push(((await up.json()) as { url: string }).url);
    }
    const posterA = { id: 'poster-a', title: 'Main flier', imageUrl: urls[0] };
    const posterB = { id: 'poster-b', title: 'Party flier', imageUrl: urls[1] };

    const first = await putLandingPatch(request, bearer, { posters: [posterA, posterB] });
    expect(first.status(), `posters PUT should be 200: ${await first.text()}`).toBe(200);
    const reordered = await putLandingPatch(request, bearer, { posters: [posterB, posterA] });
    expect(reordered.status(), `reordered posters PUT should be 200: ${await reordered.text()}`).toBe(200);

    const posters = (await publicLanding(request, tenantA.slug)).posters ?? [];
    expect(posters.map((p) => p.id), 'public poster order should match the reorder').toEqual(['poster-b', 'poster-a']);
    expect(posters.map((p) => p.imageUrl), 'poster imageUrl should be the uploaded URL').toEqual([urls[1], urls[0]]);
    const served = await request.get(urls[0]);
    expect(served.headers()['content-type'], 'the flier URL should serve an image').toMatch(/^image\//);
  });

  // Given the non-organizer (ambassador) of tenant A, and the organizer of tenant B,
  // When each POSTs an image to KEFI_LANDING_UPLOAD_PATH,
  // Then the non-organizer gets 403, and tenant B's upload is stored under tenant B only
  // (it can never land in, or overwrite, tenant A's content).
  test('AC-09 a non-organizer cannot upload and another tenant\'s organizer cannot reach tenant A', async ({ request }) => {
    const { organizerA, nonOrganizerA, organizerB } = must();
    const denied = await uploadImage(request, await bearerFor(admin, nonOrganizerA), img().png);
    expect(denied.status(), 'a non-organizer (ambassador) upload must be 403').toBe(403);
    const anonymous = await request.post(`${new URL(denied.url()).origin}${KEFI_LANDING_UPLOAD_PATH}`, { multipart: { file: img().png } });
    expect(anonymous.status(), 'an anonymous upload must be 401').toBe(401);

    const upA = await uploadImage(request, await bearerFor(admin, organizerA), img().png);
    expect(upA.status(), `tenant A upload should be 201: ${await upA.text()}`).toBe(201);
    const urlA = ((await upA.json()) as { url: string }).url;
    const bytesA = await (await request.get(urlA)).body();

    const upB = await uploadImage(request, await bearerFor(admin, organizerB), img().jpeg);
    expect(upB.status(), `tenant B upload should be 201: ${await upB.text()}`).toBe(201);
    const urlB = ((await upB.json()) as { url: string }).url;
    expect(urlB, 'tenant B upload must get its own URL, never tenant A\'s').not.toBe(urlA);
    expect((await (await request.get(urlA)).body()).equals(bytesA), 'tenant A\'s stored image must be unchanged').toBe(true);
  });
});

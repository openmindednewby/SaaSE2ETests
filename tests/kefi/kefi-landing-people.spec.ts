/**
 * KEFI-PEOPLE-1 "Organizer people editor" — acceptance tests, PUT side.
 * Spec: BaseClient/docs/Tasks/IN_PROGRESS/KEFI-PEOPLE-1-organizer-people-editor.md → "Acceptance list (G5)".
 *
 * RED STUBS, committed and locked (acceptance-lock). Each test fails on its
 * ACCEPTANCE-PENDING marker until the task that owns the AC replaces the body with
 * the Given/When/Then written above it. One test per AC; AC-04/06 and the upload half
 * of AC-09 live in `kefi-landing-upload.spec.ts`.
 *
 * Rig: two disposable canary tenants (never csdf) + organizer / non-organizer users,
 * provisioned server-side via master-admin (staging only; prod self-skips).
 *
 * NOT COVERED: every request here is hand-assembled, so this tests the server
 * contract only — the kefi-web editor's own request shape is pinned separately by
 * `expectJsonWriteShape` in kefi-web, and the editor UI by a visual-qa sighting (AC-08).
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import {
  provisionLandingPeopleFixture,
  teardownLandingPeopleFixture,
  type LandingPeopleFixture,
} from '../../helpers/kefi/kefiLandingPeopleFixture.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

test.describe('KEFI-PEOPLE-1 organizer people editor — landing-config PUT', () => {
  test.skip(!isRemoteTarget(), 'Kefi people E2E targets staging; local stack not wired in dev-loop yet');
  test.skip(!masterAdminAvailable(), 'Provisions tenants + role users via KC master-admin; only staging carries those creds.');

  const admin = new KefiAdminClient();
  let fx: LandingPeopleFixture | undefined;

  test.beforeAll(async () => {
    fx = await provisionLandingPeopleFixture(admin);
  });

  test.afterAll(async () => {
    await teardownLandingPeopleFixture(fx, admin);
  });

  // Given an organizer token and tenant A with a group,
  // When PUT KEFI_LANDING_CONFIG_PATH with a new person (name, role, topic, socials),
  // Then GET publicTenantPath(slug) returns that person with those fields.
  test('AC-01 organizer adds a person to a group and the public API returns it', async () => {
    expect(false, 'ACCEPTANCE-PENDING: AC-01').toBe(true);
  });

  // Given a group with 3 people,
  // When the organizer PUTs them reordered, one edited, one deleted,
  // Then the public API has the same order and edits, and the deleted person is gone.
  test('AC-02 organizer edits, deletes and reorders people and the public order matches', async () => {
    expect(false, 'ACCEPTANCE-PENDING: AC-02').toBe(true);
  });

  // Given an organizer,
  // When PUT with a new group (e.g. "Ambassadors"), a renamed group and a removed group,
  // Then the public API reflects all three.
  test('AC-03 organizer adds, renames and removes a group', async () => {
    expect(false, 'ACCEPTANCE-PENDING: AC-03').toBe(true);
  });

  // Given a person,
  // When PUT photoPosition inside the bounds (x,y within ±60, scale 0.5–3), then outside them,
  // Then inside round-trips through the public API; outside returns 400 from the validator.
  test('AC-05 photoPosition inside the bounds round-trips, outside them is rejected with 400', async () => {
    expect(false, 'ACCEPTANCE-PENDING: AC-05').toBe(true);
  });

  // Given a person saved with an uploaded photo (KEFI_LANDING_UPLOAD_PATH),
  // When POST publish and wait for Succeeded (admin.publishLanding + poll),
  // Then the live tenant HTML (tenantSubdomainUrl(slug)) contains the person's name and photo URL.
  test('AC-07 after publish the live tenant site shows the person with the uploaded photo', { tag: '@publish' }, async () => {
    expect(false, 'ACCEPTANCE-PENDING: AC-07').toBe(true);
  });

  // Given the non-organizer of tenant A, and the organizer of tenant B,
  // When each PUTs people,
  // Then the non-organizer gets 403, and tenant B's write never changes tenant A's public people.
  test('AC-09 a non-organizer or another tenant\'s organizer cannot write tenant A\'s people', async () => {
    expect(false, 'ACCEPTANCE-PENDING: AC-09').toBe(true);
  });
});

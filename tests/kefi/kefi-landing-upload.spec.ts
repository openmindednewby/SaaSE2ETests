/**
 * KEFI-PEOPLE-1 "Organizer people editor" — acceptance tests, upload side.
 * Spec: BaseClient/docs/Tasks/IN_PROGRESS/KEFI-PEOPLE-1-organizer-people-editor.md → "Acceptance list (G5)".
 *
 * RED STUBS, committed and locked (acceptance-lock). Each test fails on its
 * ACCEPTANCE-PENDING marker until KEFI-PEOPLE-1 T1 "Kefi upload endpoint" lands and
 * the body is replaced with the Given/When/Then written above it.
 *
 * The upload endpoint is NOT BUILT YET (2026-09-27). `KEFI_LANDING_UPLOAD_PATH`
 * ('/api/v1/admin/landing-config/images') is the planned path; if T1 ships a
 * different one, change the constant in `helpers/kefi/kefiLandingPeopleFixture.ts`.
 *
 * Rig: two disposable canary tenants (never csdf) + organizer / non-organizer users,
 * provisioned server-side via master-admin (staging only; prod self-skips).
 *
 * NOT COVERED: requests are hand-assembled, so the kefi-web upload client's own
 * multipart shape is not observed here.
 */

import { test, expect } from '@playwright/test';

import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { masterAdminAvailable } from '../../helpers/kefi/kefiKeycloakAdmin.js';
import {
  KEFI_LANDING_UPLOAD_PATH,
  provisionLandingPeopleFixture,
  teardownLandingPeopleFixture,
  type LandingPeopleFixture,
} from '../../helpers/kefi/kefiLandingPeopleFixture.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

test.describe('KEFI-PEOPLE-1 organizer people editor — landing image upload', () => {
  test.skip(!isRemoteTarget(), 'Kefi upload E2E targets staging; local stack not wired in dev-loop yet');
  test.skip(!masterAdminAvailable(), 'Provisions tenants + role users via KC master-admin; only staging carries those creds.');

  const admin = new KefiAdminClient();
  let fx: LandingPeopleFixture | undefined;

  test.beforeAll(async () => {
    fx = await provisionLandingPeopleFixture(admin);
  });

  test.afterAll(async () => {
    await teardownLandingPeopleFixture(fx, admin);
  });

  // Given the organizer of tenant A and a transparent PNG,
  // When POST it (multipart) to KEFI_LANDING_UPLOAD_PATH,
  // Then 201 with an https URL; GET of that URL returns an image whose PNG alpha survives;
  // and a non-image file is rejected with 415 or 400.
  test('AC-04 organizer uploads a person photo and gets an https URL that keeps PNG transparency', async () => {
    expect(false, `ACCEPTANCE-PENDING: AC-04 (${KEFI_LANDING_UPLOAD_PATH})`).toBe(true);
  });

  // Given the organizer of tenant A and a flier jpeg,
  // When it is uploaded to KEFI_LANDING_UPLOAD_PATH and posters are PUT reordered,
  // Then the poster imageUrl is the uploaded URL and the public API order matches.
  test('AC-06 organizer uploads a poster flier and reorders posters', async () => {
    expect(false, `ACCEPTANCE-PENDING: AC-06 (${KEFI_LANDING_UPLOAD_PATH})`).toBe(true);
  });

  // Given the non-organizer (ambassador) of tenant A, and the organizer of tenant B,
  // When each POSTs an image to KEFI_LANDING_UPLOAD_PATH,
  // Then the non-organizer gets 403, and tenant B's upload is stored under tenant B only
  // (it can never land in, or overwrite, tenant A's content).
  test('AC-09 a non-organizer cannot upload and another tenant\'s organizer cannot reach tenant A', async () => {
    expect(false, `ACCEPTANCE-PENDING: AC-09 (${KEFI_LANDING_UPLOAD_PATH})`).toBe(true);
  });
});

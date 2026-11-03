/**
 * Browser-session sign-in for kefi-web organizer `@ui` specs.
 *
 * Credentials come from env only: KEFI_PROOF_ORG_USERNAME / KEFI_PROOF_ORG_PASSWORD,
 * defaulting to the organizer of the `e2e` fixture tenant
 * (KEFI_FIXTURE_ORGANIZER_USERNAME / KEFI_FIXTURE_ORGANIZER_PASSWORD).
 */

import { fixedTenantCredentials, type BffCredentials } from '@dloizides/e2e-helpers';

export { bffLogin } from '@dloizides/e2e-helpers';

export type KefiOrganizerCreds = BffCredentials;

/** Resolve the proof organizer credentials (`e2e` fixture tenant organizer by default). */
export function proofOrganizer(): KefiOrganizerCreds {
  return fixedTenantCredentials('KEFI_PROOF_ORG', 'KEFI_FIXTURE_ORGANIZER');
}

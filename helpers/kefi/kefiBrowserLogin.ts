/**
 * Browser-session sign-in for kefi-web organizer `@ui` specs.
 *
 * A same-origin POST to `/bff/login` — the exact call the SPA's password tab
 * makes, minus the keystrokes. The browser ends up holding only the opaque
 * `__Host-bff-kefi` cookie; no token is injected. Extracted from
 * `kefi-organizer-mobile.spec.ts` on its second use (`kefi-landing-sighting.spec.ts`).
 *
 * Credentials come from env only: KEFI_PROOF_ORG_USERNAME / KEFI_PROOF_ORG_PASSWORD,
 * defaulting to the suite's sanctioned prod test organizer
 * (KEFI_TEST_USERNAME / KEFI_TEST_PASSWORD in `.env.<target>.secrets`).
 */

import type { Page } from '@playwright/test';

export interface KefiOrganizerCreds {
  username: string;
  password: string;
}

const HTTP_OK = 200;
const BODY_PREVIEW_CHARS = 200;

/** Resolve the proof organizer credentials (sanctioned test organizer by default). */
export function proofOrganizer(): KefiOrganizerCreds {
  return {
    username: process.env.KEFI_PROOF_ORG_USERNAME ?? process.env.KEFI_TEST_USERNAME ?? '',
    password: process.env.KEFI_PROOF_ORG_PASSWORD ?? process.env.KEFI_TEST_PASSWORD ?? '',
  };
}

/**
 * POST `/bff/login` from inside the page (so Origin + cookies are the browser's
 * own). The page must already be on the kefi-web origin. Throws with the status
 * and a body preview so a bad credential is unmistakable.
 */
export async function bffLogin(page: Page, creds: KefiOrganizerCreds): Promise<void> {
  const result = await page.evaluate(async (c: KefiOrganizerCreds) => {
    const res = await fetch('/bff/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
      body: JSON.stringify({ username: c.username, password: c.password }),
    });
    let body = '';
    try {
      body = await res.text();
    } catch {
      // no body
    }
    return { status: res.status, body };
  }, creds);
  if (result.status !== HTTP_OK) {
    throw new Error(
      `bffLogin: POST /bff/login → ${result.status} for '${creds.username}': ${result.body.slice(0, BODY_PREVIEW_CHARS)}`,
    );
  }
}

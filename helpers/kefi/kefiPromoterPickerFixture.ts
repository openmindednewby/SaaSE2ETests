/**
 * Shared fixture for the UBB ambassador-picker mobile specs.
 *
 * Holds the two things both spec files need — the promoter list the picker is
 * asserted against, and the network stubs — so the behaviour specs and the
 * resilience specs cannot drift apart in what they consider "the real list".
 *
 * ⚠️ THE REGISTER INTERCEPTOR IS THE PROD-SAFETY BOUNDARY. UBB is a live tenant
 * whose pre-sale opens imminently, and an orphan attendee row lands on the real
 * roster. {@link installRegisterInterceptor} fulfils `POST …/register` inside
 * the browser so the request never leaves it, on ANY target. Install it in a
 * `beforeEach` — including for tests that never press Register, because "this
 * test does not submit" is exactly the assumption that breaks when someone adds
 * a step later.
 */

import { type Page } from '@playwright/test';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/** One picker entry, matching the public endpoint's shape. */
export interface PickerPromoter {
  externalId: string;
  name: string;
}

/**
 * The exact promoter list the LIVE endpoint returns for UBB
 * (`GET /api/v1/t/ubb/promoters`, verified against production 2026-07-20).
 *
 * Mirrored here rather than fetched so the picker's rendering is asserted
 * against a KNOWN list — a test that reads its expectations from the system
 * under test cannot fail. The `@api` spec asserts this mirror still matches
 * production, so a roster change fails loudly instead of rotting silently.
 */
export const LIVE_PROMOTERS: readonly PickerPromoter[] = [
  { externalId: '680f9409-229b-4a0b-819d-655f8799f0f8', name: 'DANCEpiration' },
  { externalId: '0f47302d-0946-43b1-8abf-d14bee127c4d', name: 'Jason & Tonya' },
  { externalId: '00b96244-bc90-42ba-b5db-dac55769d4ff', name: 'Marios Zipitis' },
  { externalId: '165ca476-3ea7-4dde-ac9d-6dd0c1dff5be', name: 'Nicole Constantinou' },
  { externalId: 'b588b68b-670f-49fa-a78d-5aeedf68a9d1', name: 'Sentimiento' },
] as const;

/**
 * A RETIRED act. `IsActive = false` keeps it out of the PUBLIC picker while its
 * row, its historical referral credits and its payout lines all survive in the
 * back office — so it must appear in the organizer table and never on the form.
 */
export const RETIRED_PROMOTER_NAME = 'E2E Event-Ops Promoter (do not use)';

/** The opt-out's label, from `promoter-picker.ts` (`NO_REFERRAL_LABEL`). */
export const NO_REFERRAL_LABEL = 'Nobody — I found this myself';

/** The tenant these specs drive. */
export const UBB_SLUG = 'ubb';

/** Captures what the form WOULD have submitted, without letting it leave. */
export interface RegisterInterceptor {
  /** The parsed body of the last intercepted register POST, or null. */
  submittedBody(): Record<string, unknown> | null;
}

/** A 201 body shaped like the real register response. */
function registerCreatedBody(): Record<string, unknown> {
  return {
    attendeeExternalId: '00000000-0000-4000-8000-000000000001',
    passCode: 'FULL',
    passNumber: 'UBB-0001',
    priceEur: 35,
    ticketToken: 'e2e-mock-ticket-token',
    ticketUrl: 'https://app.kefi.dloizides.com/ticket/e2e-mock-ticket-token',
    paymentReference: 'UBB-0001',
  };
}

/**
 * Intercept the register POST and answer it locally with a 201.
 *
 * This is what makes the picker specs safe to point at production once UBB is
 * republished: the form is driven exactly as a buyer drives it, but the write
 * never reaches the tenant.
 */
export async function installRegisterInterceptor(page: Page): Promise<RegisterInterceptor> {
  let captured: Record<string, unknown> | null = null;

  await page.route(`**/api/v1/t/${UBB_SLUG}/register`, async (route) => {
    const raw = route.request().postData() ?? '{}';
    try {
      captured = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // A non-JSON body still has to be answered — the caller's status
      // assertion is what reports the real problem.
      captured = {};
    }
    await route.fulfill({
      status: HTTP_CREATED,
      contentType: 'application/json',
      body: JSON.stringify(registerCreatedBody()),
    });
  });

  return { submittedBody: () => captured };
}

/** Serve a fixed promoter list to the picker. */
export async function stubPromoters(
  page: Page,
  promoters: readonly PickerPromoter[],
): Promise<void> {
  await page.route(`**/api/v1/t/${UBB_SLUG}/promoters`, (route) =>
    route.fulfill({
      status: HTTP_OK,
      contentType: 'application/json',
      body: JSON.stringify(promoters),
    }),
  );
}

/** Fail the promoters fetch, to prove the picker degrades instead of blocking. */
export async function failPromoters(page: Page, status: number): Promise<void> {
  await page.route(`**/api/v1/t/${UBB_SLUG}/promoters`, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: '{}' }),
  );
}

/**
 * Console noise a correctly-behaving page emits when the promoters fetch fails.
 * The failed request IS logged — that is the page handling an outage, not a
 * defect. Anything outside this list still fails the test.
 */
export const PROMOTER_OUTAGE_CONSOLE_NOISE: readonly RegExp[] = [
  /promoters/i,
  /Failed to load resource/i,
  /50\d/,
];

// Stripe TEST customers created by Selida's checkout-session call, and their teardown.
//
// POST /billing/checkout-session creates a Stripe customer for the tenant before it returns the
// hosted-checkout URL. The spec never pays, so no subscription exists, but the customer does.
// It is found two ways — from the checkout session in the URL, and by the account's email — then
// deleted and READ BACK (`GET /v1/customers/{id}` → `deleted: true`).
//
// The key is `STRIPE_SECRET_KEY` (sk_test). It is only ever put in an Authorization header; no
// message built here contains it.
import { request as playwrightRequest } from '@playwright/test';

import type { APIRequestContext } from '@playwright/test';

const STRIPE_API = 'https://api.stripe.com/v1/';
const TEST_KEY_PREFIX = 'sk_test_';
const CUSTOMER_SEARCH_LIMIT = 10;

export const STRIPE_SKIP_REASON =
  'STRIPE_SECRET_KEY (sk_test_) is not set, so the Stripe customer checkout creates could not be deleted';

function stripeKey(): string {
  return process.env.STRIPE_SECRET_KEY?.trim() ?? '';
}

/** True only for a TEST key: this suite must never create or delete a live-mode customer. */
export function stripeTeardownAvailable(): boolean {
  return stripeKey().startsWith(TEST_KEY_PREFIX);
}

async function stripeApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: STRIPE_API,
    extraHTTPHeaders: { Authorization: `Bearer ${stripeKey()}` },
  });
}

async function customersFor(stripe: APIRequestContext, sessionIds: string[], emails: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const sessionId of sessionIds) {
    const session = (await (await stripe.get(`checkout/sessions/${sessionId}`)).json()) as { customer?: string | null };
    if (typeof session.customer === 'string') ids.add(session.customer);
  }
  for (const email of emails) {
    const found = (await (
      await stripe.get('customers', { params: { email, limit: CUSTOMER_SEARCH_LIMIT } })
    ).json()) as { data?: { id: string }[] };
    for (const customer of found.data ?? []) ids.add(customer.id);
  }
  return ids;
}

export class StripeCheckoutLedger {
  private readonly sessionIds = new Set<string>();

  /** Records the checkout session id carried in a hosted-checkout URL (`/c/pay/cs_test_…`). */
  track(checkoutUrl: string): void {
    const match = /(cs_test_[A-Za-z0-9]+)/.exec(new URL(checkoutUrl).pathname);
    if (match) this.sessionIds.add(match[1]);
  }

  /** Deletes every customer tied to the tracked sessions or the given emails. Returns leftovers. */
  async drain(emails: string[]): Promise<{ deleted: string[]; leftovers: string[] }> {
    const stripe = await stripeApi();
    const deleted: string[] = [];
    const leftovers: string[] = [];
    try {
      for (const id of await customersFor(stripe, [...this.sessionIds], emails)) {
        await stripe.delete(`customers/${id}`);
        const readBack = (await (await stripe.get(`customers/${id}`)).json()) as { deleted?: boolean };
        if (readBack.deleted === true) deleted.push(id);
        else leftovers.push(`Stripe customer ${id} not deleted`);
      }
    } catch (e) {
      leftovers.push(`Stripe teardown threw ${e instanceof Error ? e.message : String(e)}`);
    }
    await stripe.dispose();
    this.sessionIds.clear();
    return { deleted, leftovers };
  }
}

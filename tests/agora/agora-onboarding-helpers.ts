// Provisioning + cleanup for the ES-08 Agora onboarding journey (agora-onboarding{,.ui}.spec.ts).
//
// 🔴 WHY the SEEDED `agora-merchant-b`, not a freshly-registered merchant.
// The ideal subject is a brand-new merchant with NO shop (so the wizard runs as a genuine
// first-run). The sanctioned self-serve path — TenantService `POST /auth/register` into the `agora`
// realm (direct AND via bff-agora's `/bff/register`) — is BLOCKED on staging today: identity-api's
// realm allow-list does not include `agora`, so register (and even the admin `POST /users`) return
// 422 `INVALID_REALM` ("The provided realm is not allowed."). That is a deployment/config gap on
// identity-api (its `Authentication:AllowedRealms` never grew to include agora), NOT a test bug, and
// fixing it is a deploy change this suite must not make. See the task report for the exact one-line
// fix. Until then a NEW agora merchant cannot be minted at all.
//
// The cleanest AVAILABLE approach: the seeded `agora-merchant-b` (MERCHANT_B) is provisioned in the
// agora realm AND is currently shopless (GET /shop → 404), so the FIRST run is a true first-run
// wizard. To stay nightly-safe on re-runs (there is no delete-shop endpoint, and Agora is not in the
// canary sweep — no agora canary-cleanup endpoint exists), each test UNPUBLISHES the shop and sweeps
// the products it created in a `finally`, so MERCHANT_B is left non-public and un-bloated.
import type { APIRequestContext } from '@playwright/test';
import { AgoraApi } from './agora-client.js';
import { AGORA_API_PREFIX, AGORA_API_URL, MERCHANT_B } from './agora-helpers.js';

/** The onboarding subject: the seeded, agora-realm, (initially) shopless merchant. */
export const ONBOARDING_MERCHANT = MERCHANT_B;

/** A stable slug the wizard/API claims for MERCHANT_B's storefront subdomain (upserted each run). */
export const ONBOARDING_SHOP_SLUG = 'es08onboarding';

/** The shop name typed into wizard step 1 (upsert — safe to re-set every run). */
export const ONBOARDING_SHOP_NAME = 'ES08 Onboarding Shop';

/** Prefix on every product this journey creates, so the cleanup sweep can find + delete them. */
export const ONBOARDING_PRODUCT_PREFIX = 'ES08 Onboarding';

/** A unique product name per run (the sweep deletes any `ES08 Onboarding …`, incl. earlier runs). */
export function uniqueProductName(): string {
  return `${ONBOARDING_PRODUCT_PREFIX} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface ProductListItem {
  externalId?: string;
  name?: string;
}

/**
 * Leave MERCHANT_B tidy after a journey: unpublish its shop (so the test shop is never left publicly
 * live) and delete every `ES08 Onboarding …` product (this run's + any orphaned by an earlier
 * failure). NEVER throws — a cleanup must not mask the test result. Returns a short log line.
 */
export async function cleanupOnboardingShop(ctx: APIRequestContext, token: string): Promise<string> {
  const notes: string[] = [];
  const api = new AgoraApi(ctx, token);

  try {
    const unpub = await ctx.post(`${AGORA_API_URL}${AGORA_API_PREFIX}/shop/unpublish`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {},
    });
    notes.push(`unpublish=${unpub.status()}`);
  } catch (e) {
    notes.push(`unpublish error: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    // First page is plenty — the sweep runs every attempt, so the ES08 backlog never grows large.
    const listRes = await api.listProducts('?pageSize=100');
    if (listRes.ok()) {
      const body = (await listRes.json()) as { items?: ProductListItem[] };
      const mine = (body.items ?? []).filter(
        (p) => typeof p.name === 'string' && p.name.startsWith(ONBOARDING_PRODUCT_PREFIX) && p.externalId,
      );
      for (const p of mine) {
        const del = await api.deleteProduct(p.externalId as string);
        notes.push(`del ${p.externalId?.slice(0, 8)}=${del.status()}`);
      }
    } else {
      notes.push(`list=${listRes.status()}`);
    }
  } catch (e) {
    notes.push(`sweep error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return notes.join(' ');
}

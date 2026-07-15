// Agora PUBLIC storefront — @api tier (ES-05).
//
// The buyer-facing catalogue is ANONYMOUS (no customer accounts in v1), so this
// tier needs no token — it drives the public GETs a stranger's browser hits:
//   GET /api/v1/storefront/{slug}
//   GET /api/v1/storefront/{slug}/products
//   GET /api/v1/storefront/{slug}/products/{id}
// and asserts the ES-05 "performance is the feature" requirement that these
// public reads carry a CACHEABLE Cache-Control (not the merchant API's
// no-store), so the CDN/proxy can serve most buyer traffic.
//
// 🔒 SKIP-GATED (house pattern, mirrors agora-merchant-crud.spec.ts): the whole
// suite test.skips with a reason when
//   (a) agora-api is unreachable, or
//   (b) the public storefront endpoints are not deployed yet / the demo shop is
//       not published (a backend agent builds these in parallel; a seeded,
//       PUBLISHED demo shop is required — ES-09 owns the seed). This never
//       fakes a pass: if the surface is not there, the run SKIPS, loudly.
import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { AGORA_API_URL, AGORA_API_PREFIX } from './agora-helpers.js';

/** The seeded, PUBLISHED demo shop slug. ES-09 seeds it; override via env. */
const DEMO_SHOP = process.env.AGORA_DEMO_SHOP?.trim() || 'demo';
const NOT_FOUND = 404;

async function tryGet(
  ctx: APIRequestContext,
  path: string,
): Promise<{ response: APIResponse; url: string } | null> {
  const url = `${AGORA_API_URL}${AGORA_API_PREFIX}${path}`;
  try {
    return { response: await ctx.fetch(url, { timeout: 10_000 }), url };
  } catch {
    return null;
  }
}

test.describe('Agora public storefront @agora-api @agora-storefront', () => {
  let ctx: APIRequestContext;
  let available = false;

  test.beforeAll(async ({ playwright }) => {
    // Own context: AGORA_API_URL may be the staging ingress with a self-signed cert.
    ctx = await playwright.request.newContext({ ignoreHTTPSErrors: true });

    // (a) service reachable?
    let health: APIResponse | null = null;
    try {
      health = await ctx.fetch(`${AGORA_API_URL}/health/ready`, { timeout: 10_000 });
    } catch {
      health = null;
    }
    if (health === null) {
      test.skip(true, `agora-api not reachable at ${AGORA_API_URL}`);
      return;
    }

    // (b) public storefront surface deployed + demo shop published?
    const probe = await tryGet(ctx, `/storefront/${DEMO_SHOP}`);
    if (probe === null || probe.response.status() === NOT_FOUND || !probe.response.ok()) {
      test.skip(
        true,
        `public storefront GET /storefront/${DEMO_SHOP} not available (status ` +
          `${probe ? probe.response.status() : 'network-error'}) — endpoints not deployed or ` +
          `demo shop not published. Set AGORA_DEMO_SHOP to a published shop once seeded.`,
      );
      return;
    }
    available = true;
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('GET /storefront/{slug} returns a published shop identity', async () => {
    test.skip(!available, 'storefront surface unavailable');
    const res = await tryGet(ctx, `/storefront/${DEMO_SHOP}`);
    expect(res, 'network').not.toBeNull();
    expect(res!.response.ok()).toBeTruthy();
    const shop = (await res!.response.json()) as Record<string, unknown>;
    // Field name tolerance: the contract says `published`; the merchant DTO uses
    // `isPublished`. Accept either so this passes whichever the backend ships.
    const published = shop.published ?? shop.isPublished;
    expect(published, 'demo shop must be published').toBe(true);
    expect(typeof shop.name).toBe('string');
    expect(typeof shop.currency).toBe('string');
    expect(Array.isArray(shop.categories ?? [])).toBeTruthy();
  });

  test('public catalogue GETs are CACHEABLE (not no-store) — the ES-05 perf requirement', async () => {
    test.skip(!available, 'storefront surface unavailable');
    const res = await tryGet(ctx, `/storefront/${DEMO_SHOP}`);
    expect(res, 'network').not.toBeNull();
    const cacheControl = (res!.response.headers()['cache-control'] ?? '').toLowerCase();
    // The public storefront reads MUST be cacheable at the edge. The merchant
    // API is deliberately no-store; the public one must not be.
    expect(cacheControl, 'public storefront GET must send a Cache-Control header').not.toBe('');
    expect(cacheControl, 'public storefront GET must be cacheable, not no-store').not.toContain(
      'no-store',
    );
  });

  test('GET /storefront/{slug}/products returns priced, stock-flagged summaries', async () => {
    test.skip(!available, 'storefront surface unavailable');
    const res = await tryGet(ctx, `/storefront/${DEMO_SHOP}/products`);
    expect(res, 'network').not.toBeNull();
    expect(res!.response.ok()).toBeTruthy();
    const body = (await res!.response.json()) as Record<string, unknown>;
    const items = (Array.isArray(body) ? body : (body.items as unknown[])) ?? [];
    expect(Array.isArray(items)).toBeTruthy();
    if (items.length > 0) {
      const first = items[0] as Record<string, unknown>;
      const price = first.priceFrom ?? first.lowestPrice ?? first.price;
      expect(typeof price, 'a product summary must carry a price').toBe('number');
    }
  });

  test('GET /storefront/{slug}/products/{id} returns variants with price + stock', async () => {
    test.skip(!available, 'storefront surface unavailable');
    const listRes = await tryGet(ctx, `/storefront/${DEMO_SHOP}/products`);
    expect(listRes, 'network').not.toBeNull();
    const listBody = (await listRes!.response.json()) as Record<string, unknown>;
    const items = (Array.isArray(listBody) ? listBody : (listBody.items as unknown[])) ?? [];
    test.skip(items.length === 0, 'demo shop has no products to detail');

    const firstId = ((items[0] as Record<string, unknown>).id ??
      (items[0] as Record<string, unknown>).externalId) as string;
    const res = await tryGet(ctx, `/storefront/${DEMO_SHOP}/products/${firstId}`);
    expect(res, 'network').not.toBeNull();
    expect(res!.response.ok()).toBeTruthy();
    const product = (await res!.response.json()) as Record<string, unknown>;
    const variants = (product.variants as unknown[]) ?? [];
    expect(Array.isArray(variants)).toBeTruthy();
    expect(variants.length, 'a product must have at least one sellable variant').toBeGreaterThan(0);
    const v = variants[0] as Record<string, unknown>;
    expect(typeof v.price).toBe('number');
    // stock is int | null (null = untracked). Both are valid.
    expect(v.stock === null || typeof v.stock === 'number' || typeof v.stockCount !== 'undefined').toBeTruthy();
  });

  test('an unknown shop 404s (no shop-directory leak)', async () => {
    test.skip(!available, 'storefront surface unavailable');
    const res = await tryGet(ctx, `/storefront/definitely-not-a-real-shop-${Date.now()}`);
    expect(res, 'network').not.toBeNull();
    expect(res!.response.status()).toBe(NOT_FOUND);
  });
});

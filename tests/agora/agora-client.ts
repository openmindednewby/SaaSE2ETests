// Thin typed client over the AgoraService merchant API, for the @api E2E tier.
//
// Shapes here are taken from the C# contracts, NOT from agora-web's TypeScript —
// the frontend's types were written against an imagined server and were wrong in
// 13 places (fixed separately). The C# is the source of truth:
//   AgoraService/Agora/src/Agora.Web/{Products,Categories,Coupons,Shop}/…
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { AGORA_API_PREFIX, AGORA_API_URL, jsonAuth, bearer } from './agora-helpers.js';

/** `POST /products` — positional record; `price` and `sortOrder` are REQUIRED. */
export interface CreateProductBody {
  name: string;
  description?: string | null;
  categoryId?: string | null;
  sortOrder: number;
  price: number;
  stockCount?: number | null;
  sku?: string | null;
  /** null = option-less product (a blank-named variant is REJECTED by the validator). */
  variants?: null;
}

/** `PUT /products/{id}` — note `isActive`, NOT a status enum. */
export interface UpdateProductBody {
  name: string;
  slug?: string | null;
  description?: string | null;
  categoryId?: string | null;
  sortOrder: number;
  isActive: boolean;
  variants?: null;
}

export interface CreateCouponBody {
  code: string;
  /** String enum on the wire: 'Percentage' | 'FixedAmount'. */
  discountType: 'Percentage' | 'FixedAmount';
  value: number;
  startsAtUtc?: string | null;
  expiresAtUtc?: string | null;
  maxUses?: number | null;
  isActive: boolean;
}

export interface UpdateShopBody {
  name: string;
  slug: string;
  currency: string;
  description?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  logoStorageKey?: string | null;
}

/** `PUT /shop/stripe`. Blank secret = "keep the stored one"; the key is PROBED against Stripe. */
export interface UpdateStripeBody {
  stripeSecretKey?: string | null;
  stripeWebhookSecret?: string | null;
  paymentsEnabled: boolean;
}

/** One basket line. Note the shape: NO price — the server re-derives every number. */
export interface CheckoutItemBody {
  variantId: string;
  quantity: number;
}

/** `POST /checkout` — anonymous. `fulfilment`: 0 = Pickup, 1 = Delivery on the wire. */
export interface CheckoutBody {
  shopSlug: string;
  items: CheckoutItemBody[];
  couponCode?: string | null;
  customerName: string;
  email: string;
  phone?: string | null;
  fulfilment: number;
  shipping?: null;
}

function url(path: string): string {
  return `${AGORA_API_URL}${AGORA_API_PREFIX}${path}`;
}

export class AgoraApi {
  private readonly request: APIRequestContext;
  private readonly token: string;

  constructor(request: APIRequestContext, token: string) {
    this.request = request;
    this.token = token;
  }

  // ---------------------------------------------------------------- products
  listProducts(query = ''): Promise<APIResponse> {
    return this.request.get(url(`/products${query}`), { headers: bearer(this.token) });
  }

  getProduct(id: string): Promise<APIResponse> {
    return this.request.get(url(`/products/${id}`), { headers: bearer(this.token) });
  }

  createProduct(body: CreateProductBody): Promise<APIResponse> {
    return this.request.post(url('/products'), {
      headers: jsonAuth(this.token),
      data: body,
    });
  }

  updateProduct(id: string, body: UpdateProductBody): Promise<APIResponse> {
    return this.request.put(url(`/products/${id}`), {
      headers: jsonAuth(this.token),
      data: body,
    });
  }

  deleteProduct(id: string): Promise<APIResponse> {
    return this.request.delete(url(`/products/${id}`), { headers: bearer(this.token) });
  }

  /** Absolute stock set. Tri-state: null = untracked, 0 = tracked & sold out. */
  setVariantStock(
    productId: string,
    variantId: string,
    stock: number | null,
  ): Promise<APIResponse> {
    return this.request.put(url(`/products/${productId}/variants/${variantId}/stock`), {
      headers: jsonAuth(this.token),
      data: { stock },
    });
  }

  // -------------------------------------------------------------- categories
  listCategories(): Promise<APIResponse> {
    return this.request.get(url('/categories'), { headers: bearer(this.token) });
  }

  createCategory(name: string, sortOrder: number): Promise<APIResponse> {
    return this.request.post(url('/categories'), {
      headers: jsonAuth(this.token),
      data: { name, sortOrder },
    });
  }

  updateCategory(id: string, name: string, sortOrder: number): Promise<APIResponse> {
    return this.request.put(url(`/categories/${id}`), {
      headers: jsonAuth(this.token),
      data: { name, sortOrder },
    });
  }

  deleteCategory(id: string): Promise<APIResponse> {
    return this.request.delete(url(`/categories/${id}`), { headers: bearer(this.token) });
  }

  /** Must list EVERY category of the shop exactly once — duplicates are rejected. */
  reorderCategories(orderedIds: string[]): Promise<APIResponse> {
    return this.request.put(url('/categories/reorder'), {
      headers: jsonAuth(this.token),
      data: { orderedIds },
    });
  }

  // ----------------------------------------------------------------- coupons
  listCoupons(): Promise<APIResponse> {
    return this.request.get(url('/coupons'), { headers: bearer(this.token) });
  }

  createCoupon(body: CreateCouponBody): Promise<APIResponse> {
    return this.request.post(url('/coupons'), {
      headers: jsonAuth(this.token),
      data: body,
    });
  }

  updateCoupon(id: string, body: CreateCouponBody): Promise<APIResponse> {
    return this.request.put(url(`/coupons/${id}`), {
      headers: jsonAuth(this.token),
      data: body,
    });
  }

  deleteCoupon(id: string): Promise<APIResponse> {
    return this.request.delete(url(`/coupons/${id}`), { headers: bearer(this.token) });
  }

  // -------------------------------------------------------------------- shop
  /** 404 until the merchant creates one — that means "run onboarding", not "error". */
  getShop(): Promise<APIResponse> {
    return this.request.get(url('/shop'), { headers: bearer(this.token) });
  }

  /** UPSERT. There is no POST /shop. */
  updateShop(body: UpdateShopBody): Promise<APIResponse> {
    return this.request.put(url('/shop'), {
      headers: jsonAuth(this.token),
      data: body,
    });
  }

  updateShipping(
    flatFee: number,
    pickupEnabled: boolean,
    freeAboveSubtotal?: number | null,
  ): Promise<APIResponse> {
    return this.request.put(url('/shop/shipping'), {
      headers: jsonAuth(this.token),
      data: { flatFee, freeAboveSubtotal: freeAboveSubtotal ?? null, pickupEnabled },
    });
  }

  /**
   * ALWAYS 409 STRIPE_NOT_CONNECTED today, for every merchant. That is CORRECT:
   * a shop cannot go live until the merchant's own Stripe credentials are stored,
   * and the endpoint that stores them is ES-06. Do not "fix" the 409.
   */
  publishShop(): Promise<APIResponse> {
    return this.request.post(url('/shop/publish'), { headers: jsonAuth(this.token), data: {} });
  }

  dashboardSummary(): Promise<APIResponse> {
    return this.request.get(url('/dashboard/summary'), { headers: bearer(this.token) });
  }

  // ------------------------------------------------------------ stripe connect
  /** GET /shop/stripe — connection status + the webhook URL. NEVER returns a secret. */
  getStripe(): Promise<APIResponse> {
    return this.request.get(url('/shop/stripe'), { headers: bearer(this.token) });
  }

  /** PUT /shop/stripe — store/replace the merchant's OWN key. The key is probed against Stripe. */
  updateStripe(body: UpdateStripeBody): Promise<APIResponse> {
    return this.request.put(url('/shop/stripe'), { headers: jsonAuth(this.token), data: body });
  }

  /** DELETE /shop/stripe — disconnect. Idempotent. */
  disconnectStripe(): Promise<APIResponse> {
    return this.request.delete(url('/shop/stripe'), { headers: bearer(this.token) });
  }

  // -------------------------------------------------------------------- orders
  /** GET /orders — paged, newest first, optional `?status=Paid|Pending|…`. */
  listOrders(query = ''): Promise<APIResponse> {
    return this.request.get(url(`/orders${query}`), { headers: bearer(this.token) });
  }

  /** GET /orders/{id} — includes allowedTransitions. Foreign/unknown id → 404. */
  getOrder(id: string): Promise<APIResponse> {
    return this.request.get(url(`/orders/${id}`), { headers: bearer(this.token) });
  }

  /** POST /orders/{id}/fulfill — Paid → Fulfilled. 409 from any other state. */
  fulfillOrder(id: string): Promise<APIResponse> {
    return this.request.post(url(`/orders/${id}/fulfill`), { headers: jsonAuth(this.token), data: {} });
  }

  /** POST /orders/{id}/refund — Paid/Fulfilled → Refunded (Admin only). */
  refundOrder(id: string): Promise<APIResponse> {
    return this.request.post(url(`/orders/${id}/refund`), { headers: jsonAuth(this.token), data: {} });
  }

  // ------------------------------------------------------------------ checkout
  /** POST /checkout — ANONYMOUS; needs a connected+enabled Stripe or it refuses. */
  checkout(body: CheckoutBody): Promise<APIResponse> {
    return this.request.post(url('/checkout'), { headers: { 'Content-Type': 'application/json' }, data: body });
  }

  // ------------------------------------------------------- billing (ES-07, €2/mo platform)
  /**
   * GET /billing/subscription — the tenant's PLATFORM subscription snapshot. NOT plan-gated
   * (a paused merchant must still reach it). The FIRST call lazily starts the 30-day trial.
   */
  getBillingSubscription(): Promise<APIResponse> {
    return this.request.get(url('/billing/subscription'), { headers: bearer(this.token) });
  }

  /** POST /billing/checkout-session — €2/mo Checkout on Agora's OWN platform Stripe. Not gated. */
  createBillingCheckoutSession(): Promise<APIResponse> {
    return this.request.post(url('/billing/checkout-session'), { headers: jsonAuth(this.token), data: {} });
  }

  /** POST /billing/portal-session — Stripe Billing Portal. 409 before a Stripe customer exists. */
  createBillingPortalSession(): Promise<APIResponse> {
    return this.request.post(url('/billing/portal-session'), { headers: jsonAuth(this.token), data: {} });
  }
}

/** Unique-ish suffix so parallel/repeat runs never collide on a unique constraint. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

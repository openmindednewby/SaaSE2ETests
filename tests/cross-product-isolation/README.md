# Cross-Product Isolation E2E Suite

The regression-guard suite that proves the Phase-2 cross-realm wall holds at
the API layer. Born of the Questioner / OnlineMenu product split.

## What this suite verifies

When a user authenticates into product A (e.g. Questioner) and obtains a
token from realm A, that token must NEVER work against product B's API.
Specifically:

| Service | Accepts | Rejects |
|---|---|---|
| IdentityService | Both realms | (none) |
| QuestionerService | `questioner` ONLY | `onlinemenu`, legacy `OnlineMenu`, malformed |
| OnlineMenuService | `onlinemenu` ONLY | `questioner`, malformed |
| NotificationService | Both realms | malformed |
| ContentService | Both realms (Option-B) | malformed |
| PaymentService | Both realms | malformed |

> **Legacy `OnlineMenu` realm — retired.** The early-cutover backward-compat
> window (legacy `OnlineMenu` tokens accepted by QuestionerService) has closed.
> QuestionerService's base `appsettings.json` (inherited by staging+prod) sets
> `AllowedRealms` to `["questioner"]` only; the legacy realm survives only in
> `appsettings.Development.json`. The spec
> `legacy OnlineMenu-realm token still works against QuestionerService` in
> `cross-realm-rejection.spec.ts` is therefore `test.skip()`'d as retired
> behaviour — see the product-split roadmap.

Rejections must return **HTTP 401** (NOT 403) — 403 leaks "you exist in some
realm but not this one"; 401 says "we don't recognize you", which is the
intended anti-info-leak behaviour.

## What this suite does NOT (yet) cover

The four cross-product-isolation acceptance criteria are:

1. **API-layer rejection** — *covered here* (this suite).
2. **DOM / network-body / metadata leak** — DEFERRED to Phase 3, when the
   apps are physically split into `apps/questioner-web/` and
   `apps/onlinemenu-web/`. Until then, both products share a single
   BaseClient app, so a "no realm B strings in realm A's app" assertion
   is N/A.
3. **Email sender domain** — DEFERRED to Phase 5, when per-product Maddy
   mailboxes are provisioned (`noreply@questioner.com` /
   `noreply@onlinemenus.com`). Currently both realms route through the
   same shared mailbox.
4. **OAuth consent screens** — DEFERRED to Phase 2 / Step 3 (OAuth client
   migration) and Phase 3 (per-realm Keycloak themes). Currently the new
   realms inherit the default Keycloak theme; consent screen branding will
   be tested when each realm has its own custom theme.

## Token sources

| Realm | Token source | Rationale |
|---|---|---|
| `OnlineMenu` (legacy) | IdentityService `/api/v1/auth/login` | Same path every existing E2E test uses |
| `questioner` (new) | OIDC ROPC against `https://identity.dloizides.com/realms/questioner/protocol/openid-connect/token` | New realms don't have a custom IdentityService login flow yet |
| `onlinemenu` (new) | OIDC ROPC against the corresponding realm's OIDC token endpoint | Same |

If the new realms don't yet have an OAuth client with Direct Access Grants
enabled (Phase 2 / Step 3 dependency), the relevant tests skip with reason
`PHASE_2_STEP_3_PENDING`. The legacy-realm sanity tests still run.

## Override env vars

| Env var | Default | Use |
|---|---|---|
| `KEYCLOAK_ISSUER` | (required — set per `.env.<target>`) | The realm issuer URL (e.g. `https://staging.identity.dloizides.com/realms/OnlineMenu`). The helper **derives** the Keycloak base URL from this by stripping the `/realms/<realm>` suffix. This is the primary source. |
| `KEYCLOAK_URL` | (unset — optional) | Explicit Keycloak base URL override. Only needed if the base can't be derived from `KEYCLOAK_ISSUER`. If neither is resolvable the helper **throws** — it never falls back to a hardcoded prod URL. |
| `CROSS_PRODUCT_REALM_CLIENT_ID` | `online-menu-client` | OAuth client ID to use against the new realms (after the OAuth client migration lands, this should be one of the cloned clients) |
| `CROSS_PRODUCT_NEW_REALM_USERNAME` | `${TEST_USER_USERNAME}` | Username seeded into the new realms |
| `CROSS_PRODUCT_NEW_REALM_PASSWORD` | `${TEST_USER_PASSWORD}` | Password for that user |

## Run via Tilt

```
mcp__tilt__trigger_and_wait("playwright-e2e-cross-product-isolation", timeout=300)
```

## Run locally for debugging (NOT authoritative)

```
cd E2ETests
npm run test:cross-product-isolation
```

> Quick-mode results are not authoritative. Always confirm via the Tilt
> resource above.

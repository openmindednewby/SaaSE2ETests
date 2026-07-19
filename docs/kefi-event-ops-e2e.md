# Kefi event-ops E2E suite

Covers the **shipped and live** Kefi event-operations surfaces: public
self-registration, mark-paid, attendee CSV export, access links (mint / list /
revoke / scope filtering), door check-in, and the ledger P&L — plus a regression
guard on the organizer dashboard.

---

## Choosing a target

The harness reads **`E2E_TARGET`** (default `local`) and loads two files:

| Loaded | File | Tracked in git? |
|---|---|---|
| URLs / non-secret config | `.env.<target>` | yes |
| passwords / tokens | `.env.<target>.secrets` | **no** (gitignored) |

The run banner always tells you which was used, so a mis-targeted run is never
silent:

```
[e2e-env] target=prod urls=.env.prod secrets=.env.prod.secrets
```

Set it as an environment variable on the command line — there is no CLI flag:

```bash
# bash / git-bash
E2E_TARGET=prod npx playwright test --project=kefi-access-links

# PowerShell
$env:E2E_TARGET='prod'; npx playwright test --project=kefi-access-links
```

Valid values: `local` | `staging` | `prod`. Anything else fails fast.

---

## Which target actually runs this suite

**`prod` — and only `prod`, today.**

Every spec self-skips (it does not fail) when the target has no fixture tenant
configured, so a `local` or `staging` run reports skips rather than red.

| Target | Runs? | Why |
|---|---|---|
| `prod` | **yes** | The only environment with a published fixture tenant (UBB). |
| `staging` | skips | No published fixture tenant. Staging Kefi auth is also blocked on the F1 Keycloak JWKS debt (`Keycloak__ServerUrl` drift), which 401s every authed kefi endpoint. |
| `local` | skips | The kefi-landings static tenant pages are not built in the local dev stack. |

### Why a fixture tenant and not a canary

The register / door / ledger pages are **static Astro routes baked per tenant
slug at publish time** (`kefi-landings/src/pages/t/[slug]/*.astro` +
`getStaticPaths`). A freshly-minted canary slug has **no page at all** until a
kaniko publish job rebuilds the whole kefi-landings image (60–240 s). The `@ui`
tier therefore cannot use the usual `provisionApiTenantWithEvent` canary — it
needs a tenant that is already published.

The designated fixture is **UBB** ("United By Bachata"), which carries 159
**anonymized** demo rows (`Guest 001…159` @`example.invalid`) precisely so it is
safe to write against.

> ⚠️ **UBS is off-limits.** Its 159 rows are REAL migrated Bailemos attendees.
> Never point this suite at it.

### Configuration

`.env.prod` (tracked):

```
KEFI_FIXTURE_TENANT_SLUG=ubb
KEFI_FIXTURE_EVENT_EXTERNAL_ID=e62a3fe4-88e9-431b-8f9e-2270314049a3
KEFI_FIXTURE_ORGANIZER_USERNAME=ubb-test@dloizides.com
```

`.env.prod.secrets` (gitignored — see `.env.prod.secrets.example`):

```
KEFI_FIXTURE_ORGANIZER_PASSWORD=…
```

---

## Running

Run **one project at a time**. Several projects at once share a source IP and a
single fixture user, which trips both the per-IP rate limiter and Keycloak's
brute-force wait-increment (see *Known constraints*).

```bash
E2E_TARGET=prod npx playwright test --project=kefi-public-registration
E2E_TARGET=prod npx playwright test --project=kefi-mark-paid
E2E_TARGET=prod npx playwright test --project=kefi-attendee-export
E2E_TARGET=prod npx playwright test --project=kefi-access-links
E2E_TARGET=prod npx playwright test --project=kefi-door-checkin
E2E_TARGET=prod npx playwright test --project=kefi-ledger-pnl
E2E_TARGET=prod npx playwright test --project=kefi-organizer-access-link-regression
```

Run only one tier:

```bash
E2E_TARGET=prod npx playwright test --project=kefi-ledger-pnl --grep @api
E2E_TARGET=prod npx playwright test --project=kefi-door-checkin --grep @ui
```

---

## Prod safety

These specs write to a **live production tenant**, so cleanup is a correctness
requirement, not housekeeping. `helpers/kefi/kefiEventOpsFixture.ts` enforces it:

1. **Only ever touch what we created.** Every attendee id and access-link id is
   recorded at creation; teardown deletes/revokes exactly that set. No
   "delete everything matching a pattern" sweep exists, so a pre-existing row can
   never be caught by one.
2. **Teardown never throws.** A failing cleanup must not mask the assertion
   failure that caused it, and one failed delete must not abandon the rest.
   Failures are collected and asserted as `[]` at the end of each test.
3. **Nothing deliverable.** Attendee emails are `@example.invalid` (RFC 2606),
   which can never resolve, so no lifecycle sweep can mail a row we created.

One deliberate exception: there is **no delete-promoter endpoint**, so
`KefiPromoterClient.ensurePromoter` is idempotent by name and reuses its single
promoter forever. Over any number of runs the tenant gains exactly one extra row.

---

## Known constraints

**Registration rate limit.** `POST /t/{slug}/register` uses the strict per-IP
`Auth` policy — **5 requests / 60 s** (`RateLimiting:Auth`, same in every
environment). The `@api` client waits out the full window on a 429
(`registerWithBackoff`); the `@ui` test submits through the browser where there
is no retry hook, so it deliberately runs **first** in its file to get the fresh
budget. Note the shared `retryWhileRateLimited` is *not* used here: its capped
exponential backoff tops out around 30 s and can never clear a 60 s fixed window.

**Keycloak brute-force wait-increment.** Repeated authentication as the single
fixture organizer (each `@ui` test does a browser login *and* a server-side ROPC
mint) makes Keycloak progressively delay, then temporarily reject, that user's
logins. Symptoms: `/bff/login` hangs with the button stuck on "Signing in…" until
`waitForURL` times out, or a server-side mint returns
`invalid_grant / Invalid user credentials` despite correct credentials. It clears
on its own after a few minutes. This is why projects are run one at a time. The
durable fix is to bake an organizer `storageState` once and reuse it across the
`@ui` specs (the pattern the repo's `auth: true` chunks already use) rather than
logging in per test.

**Browser timeouts.** The global `navigationTimeout` is 15 s, which is too tight
for a cold load of the kefi-web Expo bundle. The event-ops projects use
`EVENT_OPS_BROWSER` (45 s navigation / 15 s action) instead.

---

## Known FAILING tests — a real, live production bug

Two `@ui` tests fail against prod today. **They are correct; the product is
broken.** See the report accompanying this suite for the full write-up.

`GET /api/v1/organizer/marketing-html` returns `{"html": null}` for any tenant
that has never pasted marketing HTML. `OrganizerMarketingHtmlSection` seeds its
state with `setHtml(query.data.html)` behind an `undefined`-only guard, so `html`
becomes `null` and the next render calls `null.trim()` — which throws and drops
the **entire** organizer dashboard into the app error boundary.

- `kefi-organizer-access-link-regression` → `@ui` fails with the captured
  `TypeError: Cannot read properties of null (reading 'trim')`.
- `kefi-mark-paid` → `@ui` fails downstream of the same crash. Note it can get
  *past* the "did it mount?" assertion, because the dashboard mounts before the
  marketing-html query resolves and only dies when the response lands.

Both go green once the null is handled in `kefi-web`.

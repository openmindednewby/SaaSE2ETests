# E2E Tests - Playwright Testing Service

End-to-end testing suite for the OnlineMenu SaaS microservices using Playwright.

- [E2E Tests - Playwright Testing Service](#e2e-tests---playwright-testing-service)
  - [Overview](#overview)
  - [Project Structure](#project-structure)
  - [Prerequisites](#prerequisites)
  - [Quick Start](#quick-start)
    - [1. Install Dependencies](#1-install-dependencies)
    - [2. Configure Environment](#2-configure-environment)
    - [3. Start Backend Services](#3-start-backend-services)
    - [4. Run Tests](#4-run-tests)
  - [NPM Scripts](#npm-scripts)
  - [Running with Docker](#running-with-docker)
    - [Docker Commands](#docker-commands)
  - [Test Coverage](#test-coverage)
    - [IdentityService Tests](#identityservice-tests)
    - [QuestionerService Tests](#questionerservice-tests)
    - [Smoke Tests](#smoke-tests)
  - [Writing New Tests](#writing-new-tests)
    - [Using Page Objects](#using-page-objects)
    - [Using Auth Helper](#using-auth-helper)
    - [Test Tags](#test-tags)
  - [Troubleshooting](#troubleshooting)
    - [Tests fail with "Test credentials not configured"](#tests-fail-with-test-credentials-not-configured)
    - [Tests fail with connection errors](#tests-fail-with-connection-errors)
    - [Tests timeout on login](#tests-timeout-on-login)
    - [Browser not found](#browser-not-found)
  - [CI/CD Integration (Future)](#cicd-integration-future)
  - [Related Documentation](#related-documentation)
    - [Playwright Best Practices](docs/playwright-best-practices.md)


## Overview

This is a centralized Playwright testing service that tests both the **IdentityService** and **QuestionerService** through the React Native/Expo frontend. The tests cover authentication flows, quiz template management, quiz completion, and answer viewing.

## Project Structure

```
E2ETests/
├── package.json                    # Dependencies & npm scripts
├── playwright.config.ts            # Playwright configuration
├── tsconfig.json                   # TypeScript config
├── .env.example                    # Environment template
├── .gitignore                      # Git ignores
├── Dockerfile                      # For containerized tests
│
├── fixtures/                       # Test fixtures
│   ├── auth.fixture.ts             # Extended test fixture with auth
│   ├── global-setup.ts             # Global authentication setup
│   └── index.ts
│
├── pages/                          # Page Object Models
│   ├── BasePage.ts                 # Base page class
│   ├── LoginPage.ts                # Login page interactions
│   ├── QuizTemplatesPage.ts        # Template CRUD operations
│   ├── QuizActivePage.ts           # Active quiz interactions
│   ├── QuizAnswersPage.ts          # Answer viewing
│   └── index.ts
│
├── helpers/                        # Utilities
│   ├── auth-helper.ts              # Direct API authentication
│   └── index.ts
│
├── tests/
│   ├── auth.setup.ts               # Authentication setup test
│   ├── identity/                   # IdentityService tests
│   │   ├── login.spec.ts           # Login flow tests
│   │   ├── logout.spec.ts          # Logout flow tests
│   │   └── token-refresh.spec.ts   # Token refresh tests
│   ├── questioner/                 # QuestionerService tests
│   │   ├── templates/              # Template CRUD tests
│   │   ├── quiz-active/            # Quiz filling tests
│   │   └── quiz-answers/           # Answer viewing tests
│   └── smoke/
│       └── critical-paths.spec.ts  # End-to-end smoke tests
│
└── reports/                        # Test reports (gitignored)
```

## Prerequisites

- Node.js 18+
- npm 8+
- Running backend services (or Docker)

## Quick Start

### 1. Install Dependencies

```bash
cd E2ETests
npm install
npx playwright install chromium
```

### 2. Configure Environment

E2E tests are environment-aware. `E2E_TARGET` selects which deployed environment the tests hit:

| `E2E_TARGET` | Files loaded (in order) | Target |
|--------------|------------------------|--------|
| `local` (default) | `.env.local` → `.env.local.secrets` | Local Docker stack on the dev PC |
| `staging` | `.env.staging` → `.env.staging.secrets` | Staging K3s cluster (LAN/WireGuard only) |
| `prod` | `.env.prod` → `.env.prod.secrets` (not yet committed) | Production K3s cluster |

The loader is at `fixtures/env-loader.ts`. URLs live in committed `.env.<target>` files (auditable). Secrets live in gitignored `.env.<target>.secrets` files (never committed).

For local development, the canonical files are already committed:

```env
# .env.local — URLs only (committed)
BASE_URL=http://localhost:8082
IDENTITY_API_URL=http://localhost:5002
QUESTIONER_API_URL=https://localhost:5004
ONLINEMENU_API_URL=http://localhost:5006
KEYCLOAK_ISSUER=https://identity.dloizides.com/realms/OnlineMenu
IDENTITY_REALM=OnlineMenu
```

```env
# .env.local.secrets — passwords (GITIGNORED)
TEST_USER_USERNAME=superUser
TEST_USER_PASSWORD=SuperUser123!
```

#### Targeting staging

```bash
# Default — local Docker stack on dev PC
npx playwright test tests/health/services-health.spec.ts

# Explicit local target (same as default)
E2E_TARGET=local npx playwright test tests/health/services-health.spec.ts

# Staging cluster (read on for prerequisites + caveats)
E2E_TARGET=staging npx playwright test tests/health/services-health.spec.ts --workers=1
```

Prerequisites for `E2E_TARGET=staging` from the dev PC:

1. **WireGuard tunnel up** — staging cluster has no public ingress. From the dev PC you reach it via `10.0.0.2` (WireGuard) or `192.168.10.200` (when on LAN).
2. **Host override env var** (NO HOSTS-FILE EDIT REQUIRED as of 2026-05-13) — public DNS for `*.dloizides.com` resolves to PROD. `.env.staging` ships with `E2E_HOST_OVERRIDE_IP=10.0.0.2` (WireGuard default). The mechanism (in `fixtures/host-override.ts`) does two things:
   - **Node side**: monkey-patches `dns.lookup` + `dns.promises.lookup` so axios, `APIRequestContext`, and `fetch()` resolve the 8 staging hostnames to the override IP.
   - **Chromium side**: injects `--host-resolver-rules=MAP ...` into the launched Chromium so navigation traffic from `page.goto()` hits the staging cluster too.

   For LAN operators (faster than WireGuard), put `E2E_HOST_OVERRIDE_IP=192.168.10.200` in `.env.staging.secrets` to override.

   For **Firefox + WebKit projects**, UI traffic uses the OS resolver (the `--host-resolver-rules` flag is Chromium-only). The Node-side hook still patches their API traffic. If you need full Firefox staging coverage, fall back to populating the hosts file via `personalServerNotes/k8s/generate-staging-access.sh hosts` and paste into `C:\Windows\System32\drivers\etc\hosts` as Administrator. The generator emits 30+ hostnames in one paste; the 8 SaaS hosts are included.
3. **Self-signed TLS accepted** — staging serves the Traefik default cert (no public letsencrypt). Playwright's `use.ignoreHTTPSErrors: true` (set globally in `playwright.config.ts`) handles this. `curl` callers must pass `-k`.
4. **`.env.staging.secrets` created locally** — this file is gitignored. Copy the values from the SaaS repo-root `.env.local`'s `KEYCLOAK_STAGING_MASTER_ADMIN_*` and `KEYCLOAK_TEST_USER_PASSWORD` keys.

The host-override env-var knobs (set in `.env.staging` or `.env.staging.secrets`):

| Env var | Default | Purpose |
|---|---|---|
| `E2E_HOST_OVERRIDE_IP` | `10.0.0.2` (in `.env.staging`) | IP the override sends matching hostnames to. Unset / empty → mechanism disabled (other targets). |
| `E2E_HOST_OVERRIDE_PATTERN` | `^staging\.[a-z0-9-]+\.dloizides\.com$` | Regex matching hostnames the Node-side hook should remap. |
| `E2E_HOST_OVERRIDE_HOSTS` | 8 staging hostnames in `host-override.ts` | Comma-separated hostnames the Chromium `--host-resolver-rules` arg enumerates. |

Caveats when running against staging:

- **Auth currently leaks to PROD KC** — until F1 of `e2e-multi-environment-execution.md` ships (tracked in `BaseClient/docs/Tasks/IN_PROGRESS/f1-keycloak-cert-trust.md`), staging identity-api proxies auth to **PROD** Keycloak (`saas-infra-secrets.keycloak-server-url=https://identity.dloizides.com`). Running data-creating suites against `E2E_TARGET=staging` would land Tenant{A,B,C} users in PROD KC. **Until F1 ships, run only non-destructive suites** (health probes, read-only specs). The "first live full E2E run against staging" is the final acceptance item in `phase-1-local-to-staging-e2e.md` and is explicitly **blocked on F1**.
- **Test data pollution** — once F1 ships and `multi-tenant.setup.ts` runs against staging, the `e2e-Tenant{A,B,C}` users and their tenants accumulate. Phase 1.5 of the parent design ships an orphan-cleanup script (shipped 2026-05-13). Run it from the SaaS repo root:
  ```powershell
  # Dry-run (default) — lists orphan e2e-Tenant* + e2ec-* users older than 24h:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\canary-orphan-cleanup.ps1 -Env staging

  # Mutating — actually deletes matched users:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\canary-orphan-cleanup.ps1 -Env staging -Delete

  # Tune the age threshold (default 24h):
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\canary-orphan-cleanup.ps1 -Env staging -Delete -OlderThan 48
  ```
  Tilt resource `canary-orphan-cleanup` runs the dry-run variant on demand (no auto-delete). Uses `KEYCLOAK_STAGING_MASTER_ADMIN_*` from `.env.local`. Sweeps realms `OnlineMenu`, `questioner`, `onlinemenu` on staging; `OnlineMenu` only on prod/local.
- **Observability tests don't work yet** — `LOKI_URL` / `PROMETHEUS_URL` / `GRAFANA_URL` are deliberately unset in `.env.staging`. Staging's Grafana stack has no public ingress. Suites under `tests/logging/`, `tests/monitoring/` will need to be skipped when `E2E_TARGET=staging`. Phase 4 (in-cluster K8s Job runner) is the right home for those.
- **Email capture tests don't work yet** — `MAILPIT_URL` is unset. Staging routes via Maddy SMTP.
- **Cannot run from CI or public hosts** — until Phase 4 ships the in-cluster K8s Job, staging E2E is dev-PC-only.

A non-destructive smoke that validates the env-loading + URL resolution without touching auth or data:

```bash
# From dev PC with WireGuard up (no hosts-file changes required):
curl -sk --resolve staging.identity-api.dloizides.com:443:10.0.0.2 https://staging.identity-api.dloizides.com/health/live
# Expected: 200 OK with body "Healthy"

# Playwright smoke that proves the env-var override works (Node + Chromium):
cd E2ETests && E2E_TARGET=staging npx playwright test --grep @hostresolve --workers=1
# Expected: tests/identity/host-override-smoke.spec.ts passes — confirms
# Node-side dns.lookup remap reaches staging identity-api (200 Healthy) AND
# JWT iss claim from a real login contains 'staging.identity.dloizides.com'.
```

The Playwright equivalent is `tests/health/services-health.spec.ts` — it reads `IDENTITY_API_URL`, `QUESTIONER_API_URL`, etc. straight from the loaded env file and probes `/health/{start,live,ready}` on each. No auth, no data creation.

#### Targeting prod (`E2E_TARGET=prod`) — the dry-run protocol

> ⚠️ **`E2E_TARGET=prod` creates real records in production Keycloak realms
> and DBs.** Every created entity is `e2ec-{runId8}-` prefixed (Phase 2 canary
> infrastructure) so the global-teardown's per-service cleanup endpoints sweep
> it, and the `canary-orphan-cleanup` script is the safety net. Do NOT run
> data-creating prod suites casually — follow this protocol.

**Prerequisites:**
1. `.env.prod` (committed, URLs only) + `.env.prod.secrets` (gitignored,
   `superUser` creds — the standard seed test-user). Public DNS resolves
   `*.dloizides.com` to prod with real letsencrypt certs, so **no host-override
   / hosts-file / WireGuard** is needed.
2. **ROPC pre-flight** — before any data-creating run, confirm the prod
   `onlinemenu` realm still has the `superUser` seed user:
   ```bash
   curl -s -X POST "https://identity.dloizides.com/realms/onlinemenu/protocol/openid-connect/token" \
     -d grant_type=password -d client_id=online-menu-client \
     -d username=superUser --data-urlencode "password=<from .env.prod.secrets>" -d scope=openid \
     -w "\n%{http_code}\n"
   # Expect 200 with an access_token. 401/invalid_grant → STOP, the realm
   # credential is wrong; the dry run cannot run without it.
   ```
3. **6/6-200 canary probe** — confirm all 6 services' canary-cleanup endpoints
   are live + auth-gated. Mint the superUser token, then:
   ```bash
   for svc in identity-api payment-api notification-api onlinemenu-api questioner-api content-api; do
     curl -s -X DELETE "https://$svc.dloizides.com/api/v1/internal/canary-cleanup?runId=00000000-0000-0000-0000-000000000000" \
       -H "Authorization: Bearer $TOKEN" -o /dev/null -w "$svc: %{http_code}\n" --max-time 15
   done
   # ALL 6 must return 200. Any non-200 → do NOT run the dry run; diagnose first.
   ```

**The chaperoned dry run** — `--workers=1` is **mandatory** for prod-target
runs (avoids lock contention + keeps the identity-api rate-limiter happy):
```bash
cd E2ETests
E2E_TARGET=prod npx playwright test tests/identity tests/cross-product-isolation --workers=1
```
While it runs, watch for: tests creating non-`e2ec-`-prefixed entities; any
test failing in a way that leaves data behind; and the
`global-teardown.canary.ts` calling all 6 cleanup endpoints at the end (look
for the `─── canary teardown ───` banner with `6 ok, 0 failed`).

**Post-run orphan sweep — the acceptance gate:**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\canary-orphan-cleanup.ps1 -Env prod -DryRun
# Expect 0 e2ec-* orphans. If any remain:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\canary-orphan-cleanup.ps1 -Env prod -Delete
# ...then investigate WHY teardown missed them — that's a real canary-path gap.
```

#### Rollback / kill-switch

If a prod dry run misbehaves or a canary deploy regresses prod:

- **Stop an in-progress run** — `Ctrl+C` the Playwright process. `global-teardown`
  still fires on a clean SIGINT; if it doesn't, run the orphan sweep with
  `-Delete` manually (it's idempotent).
- **Force-teardown** — the canary cleanup endpoints are idempotent and
  runId-scoped. Re-mint a superUser token and `DELETE
  /api/v1/internal/canary-cleanup?runId=<the-runId-from-the-run-banner>` against
  each of the 6 services to sweep a specific run's entities. For a blanket
  sweep, `canary-orphan-cleanup.ps1 -Env prod -Delete` matches the `e2ec-*`
  prefix across realms.
- **Roll back a regressed service image** — `apis.yml` git history holds the
  prior digest. `ssh root@204.168.225.236 "kubectl -n dloizides set image
  deployment/<svc> <svc>=10.0.0.2:5000/<svc>@<prior-sha256>"`, then
  `kubectl rollout status`. (For Phase 4/5's in-cluster K8s Job runner:
  `kubectl delete job <e2e-job>` stops the runner; the Job's own teardown step
  or the orphan-cleanup CronJob is the data safety net.)
- **Lock release** — the run-lock (see "Concurrent-run lock" below) lives in a
  ConfigMap `canary-run-lock-{target}`; if a crashed run leaves it held,
  `kubectl delete configmap canary-run-lock-staging -n dloizides` releases it.
  The orphan-cleanup CronJob also expires locks >30 min old.

#### In-cluster canary runner (Phases 4 + 5 — `staging→staging` / `prod→prod` K8s Jobs)

A one-shot K8s **Job** that runs the canary suite from *inside* the cluster —
no dev-PC hosts-file / host-override / WireGuard hop. Phase 4 shipped the
staging Job; Phase 5 the prod twin.

**Trigger it:**
```bash
tilt trigger playwright-e2e-staging-canary   # → run-canary-job.sh staging
tilt trigger playwright-e2e-prod-canary      # → run-canary-job.sh prod
```
That scps the manifests to staging, applies RBAC + the orphan-cleanup CronJob,
and (re)creates the Job. A summary email lands at `loizidesdemetris@gmail.com`
when the run finishes; the HTML report + traces are uploaded to SeaweedFS at
`s3://e2e-canary-results/staging/{runId}/`.

⚠️ The **prod** Job creates real records in prod Keycloak/DBs. The default
suite (`tests/cross-product-isolation`) is read-only / API-validation and
creates no persistent entities; the canary teardown + the weekly
orphan-cleanup CronJob are the safety nets regardless.

**One-time setup (per cluster):**
1. Build + push + digest-pin the image: `bash personalServerNotes/scripts/manage.sh deploy playwright-e2e`
   (one build pins all four manifests — staging `localhost:5000` + prod `10.0.0.2:5000` refs).
2. Apply the secret once from the template (never committed with real values):
   `personalServerNotes/k8s/playwright-e2e/secret-template.yml` → fill the
   `REPLACE_ME_*` values → `kubectl apply` as `e2e-secrets-staging` /
   `e2e-secrets-prod` (rename `metadata.name` for prod; prod's KC master-admin
   user differs from staging's — see the template's PROD block).

**DNS — why the Job's URLs differ from `.env.staging`:** the Job points the 6
API URLs at cluster-internal Service DNS (`*.dloizides.svc.cluster.local:8080`,
plain HTTP) — set directly in `k8s/playwright-e2e/job.yml.tpl`'s env block, NOT
in `.env.staging`. `KEYCLOAK_ISSUER` stays the *public* staging hostname (it's
the JWT `iss` claim the services validate); `KEYCLOAK_URL` points at the
in-cluster Keycloak Service so direct-OIDC token fetches stay in-cluster. The
dev-PC host-override is forced off (`E2E_HOST_OVERRIDE_IP=""`).

**Concurrent-run lock:** `global-setup.canary.ts` acquires a
`canary-run-lock-{target}` ConfigMap (`helpers/canary-lock.ts`); a second run
within 30 min refuses to start. `global-teardown.canary.ts` releases it. The
in-cluster Job has a real (hard) lock via its ServiceAccount RBAC; dev-PC
`local→staging` / `local→prod` runs degrade to best-effort unless you set
`E2E_LOCK_KUBECTL="ssh jim@10.0.0.2 sudo kubectl"` in `.env.staging.secrets`.
Escape hatch: `E2E_LOCK_DISABLED=true`.

**Weekly safety net:** the `playwright-e2e-orphan-cleanup` CronJob (Sunday
02:00 UTC, one per cluster) releases stale locks, sweeps `e2ec-*` Keycloak
users >24h old, and prunes SeaweedFS objects >30 days old — the in-cluster
complement to the dev-PC `canary-orphan-cleanup` Tilt resource.

**Reporting:** each run uploads its HTML report + traces + a machine-readable
`summary.json` to `s3://e2e-canary-results/{env}/{runId}/` and POSTs a summary
email (via notification-api's `/reports/smoke/email` shared-secret endpoint).
The notification-api **Daily Environment Report** has a "Canary Activity"
section that reads the last 7 days of `summary.json` files from SeaweedFS and
shows total runs / pass rate / failing runs — bold-flagged when the two most
recent runs both failed.

#### Run-book — "canary failed, what now"

A failed canary run surfaces three ways: a red Job in `kubectl get jobs`, a
`[E2E Canary] {env} {pass}/{total}` summary email, and the next-morning Daily
Report's Canary Activity section.

**Triage — flaky vs real regression:**
- A single failed run with login-flow specs failing → likely the KI-2
  identity-api `/auth/*` rate limiter (environmental flake). Re-trigger once.
- **Two consecutive failed runs** (the Daily Report bolds this) → treat as a
  real regression. Open the HTML report from S3
  (`s3://e2e-canary-results/{env}/{runId}/report/index.html`) and the traces.
- API-validation specs failing (cross-product-isolation) → a real
  cross-realm / auth-wall regression; do not dismiss.

**Kill / recover a misbehaving run:**
1. Stop the Job: `kubectl delete job playwright-e2e-{env}-canary -n dloizides --grace-period=10`
2. The canary teardown normally sweeps per-runId data; if the Job was
   SIGKILL'd before teardown, the weekly orphan-cleanup CronJob sweeps
   `e2ec-*` within a week — or run it now: `kubectl create job -n dloizides
   --from=cronjob/playwright-e2e-orphan-cleanup orphan-cleanup-manual-$(date +%s)`.
3. Release a stuck lock: `kubectl delete configmap canary-run-lock-{env} -n dloizides`.
4. Verify clean: `scripts/canary-orphan-cleanup.ps1 -Env {env} -DryRun` → expect 0.
5. Roll back a regressed service: its `apis.yml` git history has the prior
   digest — `kubectl -n dloizides set image deployment/<svc> <svc>=10.0.0.2:5000/<svc>@<prior-sha>`.

### 3. Start Backend Services

Open separate terminals and start each service:

```bash
# Terminal 1: Start IdentityService
cd C:\desktopContents\projects\SaaS\IdentityService
docker-compose up

# Terminal 2: Start OnlineMenuService
cd C:\desktopContents\projects\SaaS\OnlineMenuSaaS\OnlineMenuService
docker-compose up

# Terminal 3: Start QuestionerService (uses questioner-db service)
cd C:\desktopContents\projects\SaaS\QuestionerService
docker-compose up

# Terminal 4: Start Frontend
cd C:\desktopContents\projects\SaaS\OnlineMenuSaaS\clients\OnlineMenuClientApp
npm run start:dev
```

### 4. Run Tests

```bash
cd E2ETests
npm test
```

#### Recommended (Run In Sequence)

```bash
cd E2ETests
npm run test:health
npm run test:diagnostics
npm run test:identity
npm run test:questioner
npm run test:smoke
```

#### Useful Batches

```bash
npm run test:health
npm run test:identity
npm run test:questioner
npm run test:questioner:templates
npm run test:questioner:quiz
npm run test:smoke
```

#### Single Command (All Projects)

```bash
cd E2ETests && npx playwright test --project=health --project=identity-chromium --project=identity-mobile --project=identity-firefox --project=questioner-chromium --project=questioner-mobile --project=questioner-firefox --project=smoke-chromium --project=smoke-mobile --project=smoke-firefox
```

#### Diagnostics

```bash
cd E2ETests
npm run test:diagnostics
```

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:debug` | Run tests in debug mode |
| `npm run test:ui` | Open Playwright UI |
| `npm run test:health` | Run service probe tests only |
| `npm run test:diagnostics` | Print/validate tenantId claims (all browsers) |
| `npm run test:identity` | Run IdentityService tests only (all browsers) |
| `npm run test:questioner` | Run QuestionerService tests only (all browsers) |
| `npm run test:questioner:templates` | Run Questioner template CRUD tests (all browsers) |
| `npm run test:questioner:quiz` | Run Questioner quiz active/answers tests (all browsers) |
| `npm run test:smoke` | Run smoke tests only (all browsers) |
| `npm run report` | Open HTML test report |
| `npm run codegen` | Open Playwright codegen tool |

## Running with Docker

To run the entire stack (all services + tests) in Docker:

```bash
cd C:\desktopContents\projects\SaaS
docker compose -f docker-compose.e2e.yml up --build
```

This will:
1. Start PostgreSQL databases for each service
2. Build and start IdentityService, QuestionerService, and OnlineMenuService
3. Build and start the frontend client
4. Run Playwright tests against the stack
5. Output test reports to `E2ETests/reports/`

### Docker Commands

```bash
# Start services in background
docker compose -f docker-compose.e2e.yml up -d --build

# Run tests only
docker compose -f docker-compose.e2e.yml up playwright

# View logs
docker compose -f docker-compose.e2e.yml logs -f

# Stop all services
docker compose -f docker-compose.e2e.yml down

# Clean up volumes
docker compose -f docker-compose.e2e.yml down -v
```

## Test Coverage

### IdentityService Tests

| Test File | Coverage |
|-----------|----------|
| `login.spec.ts` | Valid/invalid credentials, empty fields, form validation |
| `logout.spec.ts` | Logout flow, session clearing, redirect to login |
| `token-refresh.spec.ts` | Token refresh via API, session maintenance |

### QuestionerService Tests

| Test File | Coverage |
|-----------|----------|
| `create-template.spec.ts` | Create templates, validation, special characters |
| `edit-template.spec.ts` | Edit modal, update name/description, cancel |
| `activate-template.spec.ts` | Activate/deactivate templates |
| `fill-quiz.spec.ts` | Display quiz, navigate pages, validation |
| `submit-quiz.spec.ts` | Submit quiz, thank you message |
| `view-answers.spec.ts` | Search answers, view details, export |
| `health/services-health.spec.ts` | Startup/liveness/readiness probes for services |

### Smoke Tests

| Test | Description |
|------|-------------|
| Complete user journey | Login -> Create template -> Activate -> View answers |
| Navigation | Verify all protected pages accessible |
| API calls | Verify authenticated API calls work |
| CRUD operations | Full template create/update/delete cycle |
| Page refresh | Verify auth state persists |
| JavaScript errors | Check for console errors across pages |

## Writing New Tests

> **Important**: Before writing tests, read the [Playwright Best Practices](docs/playwright-best-practices.md) guide for patterns that ensure fast, reliable tests.

### Using Page Objects

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

test('should login successfully', async ({ page }) => {
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login('username', 'password');
  await loginPage.expectToBeOnProtectedRoute();
});
```

### Using Auth Helper

```typescript
import { AuthHelper } from '../../helpers/auth-helper.js';

test('should refresh token', async () => {
  const authHelper = new AuthHelper();

  await authHelper.loginViaAPI('username', 'password');
  const newTokens = await authHelper.refreshTokens();

  expect(newTokens.accessToken).toBeTruthy();
});
```

### Test Tags

Use tags to categorize tests:

```typescript
test('should login @identity @auth @critical', async ({ page }) => {
  // ...
});
```

Run tagged tests:

```bash
npx playwright test --grep @critical
npx playwright test --grep @identity
npx playwright test --grep @questioner
```

## Troubleshooting

### Tests fail with "Test credentials not configured"

Ensure `.env.local` exists with valid `TEST_USER_USERNAME` and `TEST_USER_PASSWORD`.

### Tests fail with connection errors

1. Verify all backend services are running
2. Check the URLs in `.env.local` match your services
3. Ensure Keycloak is accessible

### Tests timeout on login

1. Check IdentityService logs for errors
2. Verify Keycloak realm and client configuration
3. Try running tests in headed mode: `npm run test:headed`

### Browser not found

Run `npx playwright install` to install browsers.

## CI/CD Integration (Future)

GitHub Actions workflow example (to be added in `.github/workflows/e2e.yml`):

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        run: |
          cd E2ETests
          npm ci
          npx playwright install --with-deps chromium
      - name: Run tests
        run: |
          cd E2ETests
          npm run test:ci
        env:
          TEST_USER_USERNAME: ${{ secrets.TEST_USER_USERNAME }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: E2ETests/reports/
```

## Related Documentation

- [Playwright Best Practices](docs/playwright-best-practices.md) - **Start here for writing fast, robust tests**
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [OnlineMenuSaaS README](../OnlineMenuSaaS/README.md)
- [IdentityService README](../IdentityService/README.md)
- [QuestionerService README](../QuestionerService/README.md)

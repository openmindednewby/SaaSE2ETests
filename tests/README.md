# E2E Test Tiers

This suite is organized into **three speed tiers** to match different feedback loops. Pick the tier that matches what you're trying to confirm.

| Tier | Time budget | When to run | Coverage |
|---|---|---|---|
| **Smoke (API-only)** | < 30s | After every backend deploy, nightly | API-layer cross-realm wall + 401 sanitization |
| **Critical** | < 5 min | Pre-commit on touched domain, pre-deploy gate | All `@critical`-tagged tests across all suites |
| **Full** | 30-60 min | Pre-release, weekly | Every spec (chromium) |

## Tier 1 — Smoke (API-only, sub-30s)

The fastest sustainable feedback loop. Runs in-cluster via the nightly CronJob; mirrors locally.

```bash
# Local
npm run test:smoke:api
# Staging (in-cluster, no dev-PC dependency)
ssh jim@10.0.0.2 'sudo kubectl create job --from=cronjob/playwright-e2e-nightly-staging on-demand-$(date +%s) -n dloizides'
# Prod (in-cluster)
ssh root@204.168.225.236 'kubectl create job --from=cronjob/playwright-e2e-nightly-prod on-demand-$(date +%s) -n dloizides'
```

**What it actually runs**: `tests/cross-product-isolation/` (5 specs, 50 tests, ~28s on staging/prod).

Covers the highest-blast-radius surface — the realm wall between products. If this is green, the cross-product isolation that keeps Erevna users out of Katalogos APIs (and vice-versa) is intact.

**Already runs nightly** at 04:00 UTC on both clusters via `playwright-e2e-nightly-{staging,prod}` CronJob. Results in:
- Email at 04:01 UTC (canary summary)
- Daily Environment Report at 06:30 UTC (Canary Activity section)
- Grafana `Canary Activity` dashboard
- SeaweedFS `s3://e2e-canary-results/<cluster>/<runId>/`

## Tier 2 — Critical (< 5 min)

Tests tagged `@critical` across all 9 product suites. Sub-5-min wall time on staging chromium-only. Run before any push that touches a product flow.

```bash
# Local
npm run test:critical
# Staging
npm run test:critical:staging
# Prod
npm run test:critical:prod
```

**How tests get into this tier**: tag them `@critical` in the test title:
```ts
test('should create menu with inactive status by default @critical', async () => { ... });
```

**Current `@critical` test distribution** (verify with `grep -rc "@critical" tests/`):

| Suite | Critical entries |
|---|---|
| `tests/showcase/` | 21 |
| `tests/online-menus/` | 17 |
| `tests/menu-styling/` | 20 |
| `tests/theme/` | 12 |
| `tests/questioner/` | 11 |
| `tests/identity/` | 5 |
| `tests/tenant-themes/` | 2 |
| `tests/cross-product-isolation/` | 2 |
| `tests/smoke/` | 1 |

**Aspirational sub-1-min** is achievable per individual suite (e.g. `npm run test:critical:staging -- tests/online-menus` ≈ 60-90s) but not for the entire critical set across all 9 suites; the realistic target is sub-5-min.

## Tier 3 — Full (30-60 min)

The whole suite. Run pre-release or weekly. The 1085-test full suite is broken into 22 Tilt resources for local dev — see `Tiltfile` for the resource names, or `personalServerNotes/STATE.md` for the canonical list.

```bash
# Local (via Tilt — recommended)
tilt trigger playwright-e2e-online-menus-crud-lifecycle
tilt trigger playwright-e2e-questioner-templates
# ... etc

# Local (raw)
npm test

# Staging (one suite at a time — avoid parallel-collision noise)
E2E_TARGET=staging npx playwright test tests/online-menus --workers=1
E2E_TARGET=staging npx playwright test tests/questioner --workers=1

# Prod (one suite at a time — creates real data, swept by canary teardown)
E2E_TARGET=prod npx playwright test tests/cross-product-isolation --workers=1
```

## Browser matrix

**Chromium-only.** The mobile (Pixel 5) and Firefox project triples were dropped permanently on 2026-05-20 — they roughly tripled wall-clock time, Firefox can't reach staging hosts (`--host-resolver-rules` is Chromium-only), and mobile was redundant for the API-driven flows that dominate the suite. Every UI domain now ships a single `<domain>-chromium` project. If cross-browser regression coverage is ever needed again, add a one-off project inline in `playwright.projects.ts` rather than reviving the full matrix.

## Where to see status

| Source | What it shows |
|---|---|
| **https://grafana.dloizides.com → Operations** | Live cron schedule (all CronJobs), failed-jobs (24h), recent job results |
| **https://grafana.dloizides.com → Canary Activity** | Per-night E2E canary request count + success/fail |
| **https://grafana.dloizides.com → Email Delivery** | Whether the per-run summary email actually went out |
| **Daily Environment Report email** (06:30 UTC daily) | Canary Activity section summarizes last night's run |
| **Per-run canary summary email** (after every cron fire) | Immediate pass/fail + SeaweedFS report URL |
| **SeaweedFS** `s3://e2e-canary-results/{cluster}/{runId}/` | Full Playwright HTML report + traces |
| **`E2ETests/reports/html/index.html`** (after local run) | Local Playwright HTML report — `npx playwright show-report` |

## Known-failing tests (currently skipped with `@known-bug-*` tags)

See **`BaseClient/docs/Tasks/IN_PROGRESS/online-menus-e2e-known-failures-2026-05-17.md`** for the tracking doc — 10 specs in 4 tiers, hypotheses + how to re-enable.

Find them in code:
```bash
grep -rn "@known-bug-" tests/
```

## Notes on test design

- **No setup-as-test antipattern**: setup belongs in `beforeAll`, not in a numbered `test('should create X for Y tests', ...)`. We have ~11 of those still, listed in `tests/README.md` follow-up section — refactor when touching those suites for other reasons.
- **Per-test timeout: 30s** (hard-capped in `playwright.config.ts`, tightened from 60s on 2026-05-17). Anything that needs longer is testing wrong (polling instead of asserting once). The 30s cap is policy: tests > 30s either get split into smaller atomic tests OR moved to the stress suite invoked with `--timeout=120000`.
- **describe.serial chains cascade-skip**: if you tag the first test in a serial chain with `@critical`, the chain's `beforeAll` runs — but downstream tests not tagged `@critical` won't run under `--grep "@critical"`. Tag the WHOLE chain or none.
- **Canary mode auto-cleanup**: every entity created in staging/prod E2E is `e2ec-{runId8}-` prefixed; the canary teardown sweeps via 6 per-service cleanup endpoints + the weekly `playwright-e2e-orphan-cleanup` CronJob is the safety net.

## Related docs

- `E2ETests/README.md` — install + quick-start
- `E2ETests/docs/playwright-best-practices.md` — coding style for tests
- `personalServerNotes/STATE.md` — current pass/fail snapshot + cron schedule
- `.claude/skills/e2e/SKILL.md` — `/e2e` skill (unified ops reference for running E2E)

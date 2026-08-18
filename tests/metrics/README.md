# Metrics contract suite (`@api`)

Asserts the exposition contract of the shared **`Metrics.Client` 2.0.0** NuGet package
against a **deployed** service's `/metrics`. No browser, no auth (`/metrics` is
`AllowAnonymous`), seconds to run.

```bash
npm run test:metrics-contract                      # local (.env.local)
E2E_TARGET=prod npm run test:metrics-contract      # prod
E2E_TARGET=staging npm run test:metrics-contract   # staging (needs WireGuard)
```

## What it asserts

| Defect fixed in 2.0.0 | Assertion |
|---|---|
| Raw request path used as the route label — every 404 URL minted ~14 permanent series | A request to a path that matches no route records `http_route="unmatched"`, and the raw path appears **nowhere** in the exposition (`@critical`) |
| 404 rate lost when the route label was bounded | `http_unmatched_requests_total` exists and carries **only** `app`/`method` — a route label here would reintroduce the leak |
| `service`/`endpoint` collided with Prometheus' own target labels, so ours were silently renamed `exported_service`/`exported_endpoint` | Every `http_requests_total` series carries `app` + `http_route`, and never `service`/`endpoint`; no line contains `exported_*` |
| prometheus-net's built-in `UseHttpMetrics()` double-counted | `http_requests_received_total` and `http_requests_in_progress` are absent |
| Metrics middleware sat **below** auth, so 401/403/429 were never counted | A request that 401s produces a `status_code="401"` series (`@critical`) |
| Route labels must be templates | No `http_route` value contains a GUID or a long numeric id; `/health*` and `/metrics` never appear (they are excluded from the middleware) |

Metric families with labels emit nothing until the first matching request, so **every test
drives its own traffic before scraping**, in the same test.

## Configuration

| Env var | Meaning |
|---|---|
| `METRICS_CONTRACT_SERVICES` | Comma-separated target names whose contract is **enforced** (default `agora-api`). Set per environment in `.env.<target>`. |
| `METRICS_E2E_TARGETS` | `name=url,name=url` — overrides the derived target list entirely, for a service the env files don't know about. |
| `<SERVICE>_API_URL` | Base URLs are otherwise reused from the existing `AGORA_API_URL`, `ICHNOS_API_URL`, `IDENTITY_API_URL`, … entries. Nothing is hardcoded to one host. |
| `PROMETHEUS_URL` | Enables the Prometheus-side collision check. Unset by default — Prometheus has no public ingress. |

### Why the enforced list is an allowlist, not a detection

The package is still rolling out. If the suite decided what to enforce by *sniffing* the
exposition, a service that **rolled back** to the old package would silently downgrade itself
from "failing" to "skipped". Detection reports; the allowlist decides. `metrics-rollout.spec.ts`
then **fails** if a service outside the allowlist is already on 2.0.0 — so the list cannot rot.

### Service-side vs Prometheus-side

`exported_service` / `exported_endpoint` are created **by Prometheus at scrape time**, so they
can never appear in a service's own exposition. The service-side check is a cheap guard; the
proof is in `metrics-rollout.spec.ts`, which queries Prometheus directly and is scoped to the
enforced `app` labels (a fleet-wide query would report the pending rollout as a regression).

## Tilt registration

`local_resource` definitions live in the **root `Tiltfile` (saas-root repo)**, not here. To
register `playwright-e2e-metrics-contract` (already accepted by `scripts/tilt-e2e.mjs` and
`npm run tilt:metrics-contract`), add alongside the other Playwright resources:

```python
local_resource(
    name='playwright-e2e-metrics-contract',
    labels=['Playwright'],
    cmd='npm run test:metrics-contract',
    dir='E2ETests',
    resource_deps=['e2e-lint'],
    trigger_mode=TRIGGER_MODE_MANUAL,
    auto_init=False,  # Tier 1: opt-in to save dev RAM
)
```

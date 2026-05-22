/**
 * Environment feature gates for the E2E suite.
 *
 * Some product capabilities are deliberately absent from the deployed
 * staging/prod builds. The specs that cover them must skip with a clear,
 * documented reason — exactly like the existing no-Mailpit OTP skips and the
 * Firefox-on-staging host-resolution skips.
 *
 * Each gate is opt-IN: the capability is assumed ABSENT unless the active
 * `.env.<target>` explicitly enables it. That keeps a green run honest — a
 * gate only opens when the environment genuinely has the feature.
 */

function envFlag(name: string): boolean {
  return (process.env[name] ?? '').trim().toLowerCase() === 'true';
}

/**
 * True when a real Stripe key is configured on the target's payment-api, so
 * Pro subscriptions can actually be created.
 *
 * Staging and prod currently ship a PLACEHOLDER Stripe key
 * (`sk_test_placeholder` in `saas-infra-secrets.stripe-secret-key`) — every
 * `POST /subscriptions` 500s inside Stripe's SDK, so no tenant can leave the
 * free plan. The free plan caps a tenant at 2 menus.
 *
 * Gates: the whole billing suite + the online-menus specs that need more
 * menus than the free-tier cap. Set `E2E_PAYMENTS_CONFIGURED=true` in the
 * active `.env.<target>` once a real Stripe TEST key is wired into
 * `saas-infra-secrets` on that cluster.
 */
export function paymentsConfigured(): boolean {
  return envFlag('E2E_PAYMENTS_CONFIGURED');
}

export const PAYMENTS_SKIP_REASON =
  'Payments not configured on this environment: payment-api ships a placeholder ' +
  'Stripe key (sk_test_placeholder), so Pro subscriptions cannot be created and ' +
  'tenants are capped at the free-tier 2-menu limit. Set E2E_PAYMENTS_CONFIGURED=true ' +
  'once a real Stripe test key is wired into saas-infra-secrets.';

/**
 * True when the deployed app build ships the theme-preset editor and the
 * `/showcase` developer component gallery.
 *
 * The per-product apps build with `EXPO_PUBLIC_ENABLE_THEME_EDITOR=false` in
 * production (deliberate — see each app's `src/config/environment.ts`: "Theme
 * editor / showcase section (disabled in prod by default)"). The
 * `enableThemeEditor` flag gates BOTH the theme-preset editor UI and the
 * entire `/showcase` route (`<FeatureGate flag="enableThemeEditor">`), so the
 * deployed staging/prod apps have neither.
 *
 * Gates: the theme-preset suite, the `/showcase` suite, and the tenant-theme
 * preset picker. Set `E2E_THEME_EDITOR_ENABLED=true` in the active
 * `.env.<target>` if a build with the flag enabled is deployed there.
 */
export function themeEditorEnabled(): boolean {
  return envFlag('E2E_THEME_EDITOR_ENABLED');
}

/**
 * True when the Grafana Loki endpoint is reachable for the active target.
 *
 * The observability stack (Loki / Prometheus / Grafana) lives INSIDE each
 * cluster with no public ingress, so a dev-PC run targeting staging/prod
 * cannot reach it — `.env.staging` / `.env.prod` deliberately leave
 * `LOKI_URL` / `PROMETHEUS_URL` / `GRAFANA_URL` unset. The observability
 * suites must skip in that case (they otherwise fall back to a localhost URL
 * and fail on a connection error). The in-cluster nightly K8s Job runs these
 * suites from inside the cluster network, where the URLs are set.
 */
export function lokiConfigured(): boolean {
  return !!process.env.LOKI_URL && process.env.LOKI_URL.trim().length > 0;
}

export const LOKI_SKIP_REASON =
  'Loki not configured for this target: the observability stack has no public ' +
  'ingress, so a dev-PC run cannot reach it (LOKI_URL unset in .env.<target>). ' +
  'The logging suites run from the in-cluster nightly K8s Job instead.';

/**
 * True when both the Prometheus and Grafana endpoints are reachable for the
 * active target. Same in-cluster-only constraint as {@link lokiConfigured}.
 */
export function monitoringConfigured(): boolean {
  const prom = (process.env.PROMETHEUS_URL ?? '').trim();
  const graf = (process.env.GRAFANA_URL ?? '').trim();
  return prom.length > 0 && graf.length > 0;
}

export const MONITORING_SKIP_REASON =
  'Monitoring stack not configured for this target: Prometheus + Grafana have ' +
  'no public ingress, so a dev-PC run cannot reach them (PROMETHEUS_URL / ' +
  'GRAFANA_URL unset in .env.<target>). The monitoring suites run from the ' +
  'in-cluster nightly K8s Job instead.';

export const THEME_EDITOR_SKIP_REASON =
  'Theme editor + /showcase are flag-disabled in production builds ' +
  "(EXPO_PUBLIC_ENABLE_THEME_EDITOR=false — deliberate, see each app's " +
  'src/config/environment.ts). The deployed app has no theme-preset editor or component-' +
  'showcase screens. Set E2E_THEME_EDITOR_ENABLED=true if a build with the flag ' +
  'enabled is deployed.';

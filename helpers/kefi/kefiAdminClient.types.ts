/**
 * Shared types + helpers for the Kefi admin client. Pulled out of the main
 * file to keep it below the 300-line file-size lint threshold.
 */

export interface AdminClientOptions {
  /** Username of the kefi-platform-admin user. Reads KEFI_PLATFORM_ADMIN_USERNAME by default. */
  username?: string;
  /** Password for the user. Reads KEFI_PLATFORM_ADMIN_PASSWORD by default. */
  password?: string;
  /** bff-kefi-client secret. Reads KEFI_BFF_CLIENT_SECRET by default. */
  clientSecret?: string;
}

export interface WelcomeSweepResult {
  eligibleCount: number;
  sentCount: number;
  skippedCount: number;
}

export interface CanaryCleanupResult {
  canaryId: string;
  tenantsDeleted: number;
  usersDeleted: number;
  ingressesDeleted: number;
  certificatesDeleted: number;
  secretsDeleted: number;
}

/** Shape of POST /admin/landing-config/publish + GET /admin/landing-config/publish/{jobName}. */
export interface PublishLandingResult {
  tenantSlug: string;
  jobName: string;
  status: string;
  enqueuedAtUtc: string;
  message: string;
}

/** Shape of GET /api/v1/internal/canary-tenant?canaryId= — the Phase-D DB-state probe. */
export interface CanaryTenantState {
  canaryId: string;
  /** false when no tenant matches the e2c-{canaryId}- prefix (swept clean or never created). */
  found: boolean;
  slug: string;
  status: string;
  onboardingCompleted: boolean;
  /** ISO timestamp the welcome worker stamped after dispatch, or null. */
  welcomeEmailSentAtUtc: string | null;
}

/** Internal — KC OAuth2 token-endpoint response (camel-case is wire format). */
export interface RawTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/** Terminal statuses for the publish Job — anything else = still running. */
export const PUBLISH_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['Succeeded', 'Failed']);

/**
 * Pull a required secret from env, with a clear error path. Used by the admin
 * client when an explicit override wasn't passed in the constructor options.
 */
export function requireSecret(name: string, override: string | undefined): string {
  if (override && override.length > 0) return override;
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[kefiAdminClient] Required env var ${name} is unset. Add it to .env.<target>.secrets.`,
    );
  }
  return value;
}

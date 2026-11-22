export const DEFAULT_CANARY_REALM = 'platform';
export const DEFAULT_CANARY_CLIENT_ID = 'canary-cleanup';
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const ERROR_BODY_MAX_CHARS = 200;

export interface CanaryClientConfig {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface CanaryServiceToken {
  readonly accessToken: string;
  readonly expiresInSeconds: number | undefined;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function envOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/** Client-credentials config for the canary cleanup service account, or undefined when CANARY_CLIENT_SECRET is unset. */
export function canaryClientConfigFromEnv(
  keycloakBaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): CanaryClientConfig | undefined {
  const clientSecret = env.CANARY_CLIENT_SECRET?.trim();
  if (!clientSecret) return undefined;
  const realm = envOrDefault(env.CANARY_REALM, DEFAULT_CANARY_REALM);
  const base = keycloakBaseUrl.replace(/\/+$/, '');
  return {
    tokenUrl: `${base}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`,
    clientId: envOrDefault(env.CANARY_CLIENT_ID, DEFAULT_CANARY_CLIENT_ID),
    clientSecret,
  };
}

/** Mints the canary cleanup access token with the client_credentials grant. */
export async function mintCanaryServiceToken(
  config: CanaryClientConfig,
  fetchImpl: FetchLike = fetch,
): Promise<CanaryServiceToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const response = await fetchImpl(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, ERROR_BODY_MAX_CHARS);
    throw new Error(
      `client_credentials grant for "${config.clientId}" at ${config.tokenUrl} returned HTTP ${response.status}: ${detail}`,
    );
  }
  const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
    throw new Error(`client_credentials grant for "${config.clientId}" returned no access_token`);
  }
  return {
    accessToken: json.access_token,
    expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : undefined,
  };
}

import axios from 'axios';

import { sharedHttpsAgent } from './http-agent.js';

export const PLATFORM_REALM = 'platform';
export const CANARY_CLEANUP_CLIENT_ID = 'canary-cleanup';
const MINT_TIMEOUT_MS = 15000;
const HTTP_OK = 200;
const REALM_PATH = /\/realms\/[^/]+\/?$/;

export interface CleanupTokenChoice {
  token: string | null;
  source: 'platform-client' | 'user-token' | 'none';
  note: string;
}

export type ClientCredentialsMinter = (tokenUrl: string, clientId: string, clientSecret: string) => Promise<string>;

export function platformClientSecret(target: string, env: NodeJS.ProcessEnv): string | undefined {
  const perTarget = env[`PLATFORM_CANARY_CLIENT_SECRET_${target.toUpperCase()}`];
  return perTarget && perTarget.length > 0 ? perTarget : env.PLATFORM_CANARY_CLIENT_SECRET || undefined;
}

export function platformTokenUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.PLATFORM_CANARY_TOKEN_URL) return env.PLATFORM_CANARY_TOKEN_URL;
  const issuer = env.KEYCLOAK_ISSUER;
  if (!issuer || !REALM_PATH.test(issuer)) return undefined;
  return `${issuer.replace(REALM_PATH, `/realms/${PLATFORM_REALM}`)}/protocol/openid-connect/token`;
}

export const mintClientCredentials: ClientCredentialsMinter = async (tokenUrl, clientId, clientSecret) => {
  const resp = await axios.post(
    tokenUrl,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    { timeout: MINT_TIMEOUT_MS, httpsAgent: sharedHttpsAgent, validateStatus: () => true },
  );
  const accessToken: unknown = resp.data?.access_token;
  if (resp.status !== HTTP_OK || typeof accessToken !== 'string') {
    throw new Error(`client_credentials mint at ${tokenUrl} returned HTTP ${resp.status}`);
  }
  return accessToken;
};

/** Picks the platform canary-cleanup service-account token for the cleanup calls, else the user token. */
export async function chooseCleanupToken(
  target: string,
  userToken: string | null,
  env: NodeJS.ProcessEnv = process.env,
  mint: ClientCredentialsMinter = mintClientCredentials,
): Promise<CleanupTokenChoice> {
  const fallback = (note: string): CleanupTokenChoice =>
    userToken === null ? { token: null, source: 'none', note } : { token: userToken, source: 'user-token', note };

  const secret = platformClientSecret(target, env);
  if (!secret) return fallback(`PLATFORM_CANARY_CLIENT_SECRET_${target.toUpperCase()} unset`);
  const tokenUrl = platformTokenUrl(env);
  if (!tokenUrl) return fallback('no platform token URL (KEYCLOAK_ISSUER unset)');

  try {
    const token = await mint(tokenUrl, CANARY_CLEANUP_CLIENT_ID, secret);
    return { token, source: 'platform-client', note: `minted ${CANARY_CLEANUP_CLIENT_ID} token (realm=${PLATFORM_REALM})` };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
}

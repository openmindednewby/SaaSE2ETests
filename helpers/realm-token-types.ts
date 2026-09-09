/**
 * Shared type definitions for `realm-token-helper.ts`. Split out to keep that
 * file under the max-file-lines limit.
 */

export type RealmName = 'OnlineMenu' | 'questioner' | 'onlinemenu';

export interface RealmTokenAcquisitionResult {
  realm: RealmName;
  accessToken: string | null;
  /** Reason the token could not be acquired, when accessToken is null. */
  unavailableReason: string | null;
  /** Source path used: 'identity-api' (legacy realm) or 'oidc-direct' (new realms). */
  source: 'identity-api' | 'oidc-direct' | null;
}

export interface OidcTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

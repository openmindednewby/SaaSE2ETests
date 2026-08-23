/**
 * The ONE probe both the live fleet spec and the negative-control spec drive.
 *
 * ⚠️ Deliberately NOT split into "pure helpers the tests assert on". A suite of
 * green pure helpers over a broken integration is a known failure mode in this
 * repo: the comparison function passes its unit tests while the code that
 * FETCHES the two issuers quietly fetches the wrong thing, or fetches nothing
 * and reports agreement. So the whole flow — config read, front-channel
 * redirect, discovery fetch, comparison — lives here, and
 * `authcode-negative-control.spec.ts` runs THIS function against a
 * deliberately-mismatched fixture. Every run therefore re-proves that the probe
 * can still fail.
 */
import type { APIRequestContext } from '@playwright/test';

import {
  type AuthCodePortal,
  type BffIssuerConfig,
  CONFIG_PATH,
  FRONT_CHANNEL_PATH,
  ISSUER_STATUS_RESOLVED,
  ISSUER_STATUS_UNREACHABLE,
  discoveryUrlFor,
  issuerDisagreement,
  publishesPasskey,
} from './authcode-agreement.js';

const HTTP_OK = 200;
const HTTP_FOUND = 302;
const HTTP_NOT_FOUND = 404;
const HTTP_NOT_IMPLEMENTED = 501;

/**
 * `skip` = this portal could not be checked and NOBODY IS GUARDING IT — said out
 * loud, never folded into a pass. `fail` = a real finding. `ok` = front and back
 * demonstrably name one issuer.
 */
export type AuthCodeProbe =
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'fail'; readonly reason: string }
  | { readonly kind: 'ok'; readonly issuer: string; readonly authorizeUrl: string };

function firstLine(error: unknown): string {
  return String((error as Error)?.message ?? error).split('\n')[0];
}

/** Reads the BFF's own resolved BACK-channel issuer from `GET /bff/config`. */
async function readBackChannel(
  request: APIRequestContext,
  portal: AuthCodePortal,
): Promise<AuthCodeProbe | { readonly config: BffIssuerConfig; readonly issuer: string }> {
  let response;
  try {
    response = await request.get(`${portal.baseUrl}${CONFIG_PATH}`, { failOnStatusCode: false });
  } catch (error) {
    return { kind: 'skip', reason: `${portal.label}: ${portal.baseUrl} unreachable (${firstLine(error)}) — NO GUARD RAN.` };
  }

  if (response.status() === HTTP_NOT_FOUND) {
    return { kind: 'skip', reason: `${portal.label}: no ${CONFIG_PATH} — predates Bff.AspNetCore 1.10.0. NO GUARD RAN.` };
  }
  if (response.status() !== HTTP_OK) {
    return { kind: 'fail', reason: `${portal.label}: GET ${CONFIG_PATH} returned ${response.status()}.` };
  }

  const config = (await response.json()) as BffIssuerConfig;

  // A response with no `issuerStatus` at all predates 1.16.0, where the field was
  // added precisely because a bare null issuer was uninterpretable from outside.
  // Absent field => no coverage; say so rather than passing vacuously.
  if (config.issuerStatus === undefined) {
    return { kind: 'skip', reason: `${portal.label}: ${CONFIG_PATH} publishes no issuerStatus — Bff.AspNetCore < 1.16.0. NO GUARD RAN; upgrade the package.` };
  }

  if (config.issuerStatus === ISSUER_STATUS_UNREACHABLE) {
    return { kind: 'fail', reason: `${portal.label}: back-channel discovery is STILL unreadable (issuerStatus='${ISSUER_STATUS_UNREACHABLE}'). This BFF is serving traffic without having confirmed which identity provider it redeems authorization codes at, and the background re-resolve has not recovered.` };
  }
  if (config.issuerStatus !== ISSUER_STATUS_RESOLVED || !config.issuer) {
    return { kind: 'fail', reason: `${portal.label}: issuerStatus='${config.issuerStatus}' issuer='${config.issuer ?? 'null'}'. A BFF with Bff:Keycloak:Authority configured must resolve one; this value means it reports having none.` };
  }

  return { config, issuer: config.issuer };
}

/** Follows ONE hop of the anonymous front-channel navigation and returns its target. */
async function readFrontChannelTarget(
  request: APIRequestContext,
  portal: AuthCodePortal,
): Promise<AuthCodeProbe | { readonly authorizeUrl: string }> {
  let response;
  try {
    response = await request.get(`${portal.baseUrl}${FRONT_CHANNEL_PATH}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
  } catch (error) {
    return { kind: 'fail', reason: `${portal.label}: GET ${FRONT_CHANNEL_PATH} threw (${firstLine(error)}).` };
  }

  if (response.status() === HTTP_NOT_IMPLEMENTED) {
    return { kind: 'skip', reason: `${portal.label}: passkey login disabled (501) — the front channel is not anonymously probeable here. NO GUARD RAN.` };
  }
  if (response.status() !== HTTP_FOUND) {
    return { kind: 'fail', reason: `${portal.label}: GET ${FRONT_CHANNEL_PATH} returned ${response.status()}, expected a ${HTTP_FOUND} to the identity provider.` };
  }

  const location = response.headers()['location'];
  if (!location) {
    return { kind: 'fail', reason: `${portal.label}: the front-channel redirect carried no Location header.` };
  }
  return { authorizeUrl: location };
}

/** Reads the `issuer` the provider at the redirect target reports about ITSELF. */
async function readFrontChannelIssuer(
  request: APIRequestContext,
  portal: AuthCodePortal,
  authorizeUrl: string,
): Promise<AuthCodeProbe | { readonly issuer: string }> {
  const discoveryUrl = discoveryUrlFor(authorizeUrl);
  if (discoveryUrl === null) {
    return { kind: 'fail', reason: `${portal.label}: cannot derive a discovery URL from the authorize URL '${authorizeUrl}' — it is neither Keycloak- nor OpenIddict-shaped, so the front channel cannot be verified.` };
  }

  let response;
  try {
    response = await request.get(discoveryUrl, { failOnStatusCode: false });
  } catch (error) {
    return { kind: 'fail', reason: `${portal.label}: the browser is redirected to '${authorizeUrl}', but ${discoveryUrl} is UNREACHABLE from the E2E runner (${firstLine(error)}). A front channel nobody can reach is a dead login button — this is the shape a non-public host (an in-cluster Service name, or a WireGuard-only staging Keycloak) produces.` };
  }
  if (response.status() !== HTTP_OK) {
    return { kind: 'fail', reason: `${portal.label}: ${discoveryUrl} returned ${response.status()} — the front-channel origin serves no OIDC discovery document.` };
  }

  const issuer = ((await response.json()) as { issuer?: string }).issuer;
  if (!issuer) {
    return { kind: 'fail', reason: `${portal.label}: ${discoveryUrl} carries no 'issuer' field.` };
  }
  return { issuer };
}

function isProbe(value: object): value is AuthCodeProbe {
  return 'kind' in value;
}

/**
 * Probes one portal end to end. Never throws: an unreachable portal is an
 * environment fact (`skip`, said loudly), a disagreeing pair is a finding
 * (`fail`). Both are distinct from `ok`, and nothing collapses into it.
 */
export async function probeAuthCodeAgreement(
  request: APIRequestContext,
  portal: AuthCodePortal,
): Promise<AuthCodeProbe> {
  const back = await readBackChannel(request, portal);
  if (isProbe(back)) return back;

  if (!publishesPasskey(back.config)) {
    return { kind: 'skip', reason: `${portal.label}: publishes no passkey method, so no anonymous front-channel navigation exists to probe. NO GUARD RAN.` };
  }

  const target = await readFrontChannelTarget(request, portal);
  if (isProbe(target)) return target;

  const front = await readFrontChannelIssuer(request, portal, target.authorizeUrl);
  if (isProbe(front)) return front;

  const disagreement = issuerDisagreement(portal.label, front.issuer, back.issuer);
  if (disagreement !== null) {
    return { kind: 'fail', reason: disagreement };
  }
  return { kind: 'ok', issuer: back.issuer, authorizeUrl: target.authorizeUrl };
}

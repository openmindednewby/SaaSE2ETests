/**
 * Phase F probe — asserts a config-only (Free) tenant's landing page is served
 * dynamically, rendered entirely from its saved LandingConfig with NO
 * hand-authored data file.
 *
 * Unlike the KUCY probe (which checks a hand-authored tenant survived the
 * rebuild), this fetches the canary tenant's OWN page via the path route
 * `${KEFI_WEB_URL}/t/<slug>/` — reachable for any slug since Phase F broadened
 * the kefi-web Ingress `/t` rule to a prefix. The path route is target-agnostic
 * (no per-tenant DNS / cert needed), so it works on staging's WG-only cluster.
 *
 * The defining marker is the "Made with Kefi" footer badge: only the dynamic
 * config→TenantSite mapper (buildTenantSiteFromConfig) emits it, so its presence
 * proves the page came from the Phase F render path — not a hand-authored build
 * and not the kefi-web SPA shell.
 */

import axios from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

export interface DynamicLandingProbeResult {
  status: number;
  url: string;
  matchedMarkers: string[];
  missingMarkers: string[];
}

/**
 * GET the dynamic tenant's path-route landing and assert every required marker
 * is present. Retries while non-200 or markers missing (the kefi-landings
 * rollout after the publish Job can briefly 502 / serve a stale image).
 * Throws on timeout with the last status + missing markers.
 */
export async function probeDynamicLandingRender(input: {
  slug: string;
  requiredMarkers: readonly string[];
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<DynamicLandingProbeResult> {
  const { webUrl } = getKefiUrls();
  const url = `${webUrl.replace(/\/+$/, '')}/t/${input.slug}/`;
  const timeoutMs = input.timeoutMs ?? 120_000;
  const pollIntervalMs = input.pollIntervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  let last: DynamicLandingProbeResult = {
    status: 0,
    url,
    matchedMarkers: [],
    missingMarkers: [...input.requiredMarkers],
  };

  while (Date.now() < deadline) {
    try {
      const resp = await axios.get<string>(url, {
        httpsAgent: sharedHttpsAgent,
        timeout: 15_000,
        responseType: 'text',
        validateStatus: () => true,
      });
      if (resp.status === 200 && typeof resp.data === 'string') {
        const matched: string[] = [];
        const missing: string[] = [];
        for (const marker of input.requiredMarkers) {
          if (resp.data.includes(marker)) {
            matched.push(marker);
          } else {
            missing.push(marker);
          }
        }
        last = { status: 200, url, matchedMarkers: matched, missingMarkers: missing };
        if (missing.length === 0) {
          return last;
        }
      } else {
        last = { status: resp.status, url, matchedMarkers: [], missingMarkers: [...input.requiredMarkers] };
      }
    } catch {
      // Network blip mid-rollout — keep polling until the deadline.
    }
    await delay(pollIntervalMs);
  }

  if (last.status !== 200) {
    throw new Error(
      `[kefiDynamicLandingProbe] GET ${url} did not return 200 within ${String(timeoutMs)}ms — last status ${String(last.status)}`,
    );
  }
  throw new Error(
    `[kefiDynamicLandingProbe] GET ${url} returned 200 but missing markers: ${last.missingMarkers.join(', ')}`,
  );
}

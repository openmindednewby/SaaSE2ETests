/**
 * Phase C subdomain probe — asserts the kefi-landings rebuild rendered
 * KUCY's hand-authored landing without regression.
 *
 * The canary tenant's publish job rebuilds the entire kefi-landings image
 * (kaniko clones the kefi-landings repo + runs Astro build with
 * KEFI_API_BASE_URL set + nginx serves the rebuilt dist). That rebuild
 * regenerates KUCY's `/t/kizomba-union-cy/index.html` from KUCY's
 * hand-authored TenantSite + the live API overlay. If anything in the
 * shared template-1 components, the API overlay, or kefi-api's
 * /api/v1/t/{slug} contract broke, the rebuild surfaces it here.
 *
 * Note (deliberate): the canary tenant's OWN slug is NOT probed — Astro's
 * getStaticPaths doesn't enumerate dynamically-created tenants, and nginx
 * has no wildcard server block. Adding dynamic tenant enumeration is a
 * separate phase (see plan doc Phase F polish).
 */

import axios from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import { sharedHttpsAgent } from '../http-agent.js';
import { getKefiUrls } from './kefiUrls.js';

/**
 * Strings every Template-1 render of KUCY's landing must contain. Sourced
 * from the rendered HTML of `kizomba-union-cy.kefi.dloizides.com` — see
 * inline notes. Counts as a regression if any are missing post-publish.
 */
const REQUIRED_KUCY_MARKERS: readonly string[] = [
  'Kizomba Union CY',
  'Teachers',
  'Ambassadors',
  'Schedule',
  // KUCY's data file labels the party section just "Party" (used in copy,
  // section IDs, and og:description). Don't expect "The Party".
  'Party',
  'Venue',
  'Bailemos',
];

export interface KucyProbeResult {
  /** Final HTTP status of the GET. */
  status: number;
  /** Markers from REQUIRED_KUCY_MARKERS that were present in the body. */
  matchedMarkers: string[];
  /** Markers that were missing — empty when the probe passed cleanly. */
  missingMarkers: string[];
}

/**
 * GET the KUCY landing URL and assert every required marker is present.
 * Throws when any marker is missing or the response isn't 200.
 *
 * Retries while the response is non-200 or the body has all-zero markers
 * (e.g. mid-rollout 502 from the kefi-landings Service). Budget defaults to
 * 90s — typical rollout finishes in 20-40s after the publish Job reports
 * Succeeded.
 */
export async function probeKucyLandingRender(input?: {
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<KucyProbeResult> {
  const { kucyLandingUrl } = getKefiUrls();
  const timeoutMs = input?.timeoutMs ?? 90_000;
  const pollIntervalMs = input?.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  let lastResult: KucyProbeResult = {
    status: 0,
    matchedMarkers: [],
    missingMarkers: [...REQUIRED_KUCY_MARKERS],
  };

  while (Date.now() < deadline) {
    try {
      const resp = await axios.get<string>(kucyLandingUrl, {
        httpsAgent: sharedHttpsAgent,
        timeout: 15_000,
        responseType: 'text',
        validateStatus: () => true,
      });
      if (resp.status === 200 && typeof resp.data === 'string') {
        const matched: string[] = [];
        const missing: string[] = [];
        for (const marker of REQUIRED_KUCY_MARKERS) {
          if (resp.data.includes(marker)) {
            matched.push(marker);
          } else {
            missing.push(marker);
          }
        }
        lastResult = { status: 200, matchedMarkers: matched, missingMarkers: missing };
        if (missing.length === 0) {
          return lastResult;
        }
      } else {
        lastResult = {
          status: resp.status,
          matchedMarkers: [],
          missingMarkers: [...REQUIRED_KUCY_MARKERS],
        };
      }
    } catch {
      // Network blip mid-rollout — keep polling until the deadline.
    }
    await delay(pollIntervalMs);
  }

  if (lastResult.status !== 200) {
    throw new Error(
      `[kefiKucyProbe] GET ${kucyLandingUrl} did not return 200 within ${String(timeoutMs)}ms — last status ${String(lastResult.status)}`,
    );
  }
  throw new Error(
    `[kefiKucyProbe] GET ${kucyLandingUrl} returned 200 but missing KUCY markers: ${lastResult.missingMarkers.join(', ')}`,
  );
}

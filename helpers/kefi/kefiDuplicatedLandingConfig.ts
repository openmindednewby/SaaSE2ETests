/**
 * Duplicated-landing fixture for the Kefi crew-lifecycle E2E (task #267 STEP 4).
 *
 * Mirrors the ubb provision flow's "duplicate an existing tenant's landing"
 * step: take the KUCY-shaped config and add the DISPLAY `passes` + `posters`
 * arrays (the LandingConfigDto extension #266 introduced — display tiers, NOT
 * the transactional event Pass entity). The publish validator only constrains
 * these two arrays (each pass needs id+name+price; each poster's img/download
 * must be an absolute http(s) URL or null), so they are the parts most worth
 * exercising through a real PUT + publish.
 */

import { buildKucyShapedConfig, type SavedLandingDto } from './kefiKucyShapedConfig.js';

/** A display pass tier (config-level, distinct from the event Pass entity). */
interface DisplayPass {
  id: string;
  name: string;
  price: string;
  description?: string;
  featured?: boolean;
  badge?: string;
}

/** A display poster (img/download must be absolute http(s) or null per the validator). */
interface DisplayPoster {
  id: string;
  title: string;
  imageUrl?: string | null;
  downloadUrl?: string | null;
}

/**
 * Build a SavedLandingDto that copies the KUCY-shaped config and adds
 * canary-prefixed display passes (€15 / €30 / €20, mirroring ubb) + a poster.
 *
 * By default the poster `imageUrl`/`downloadUrl` are null (no real asset) — a
 * valid value the validator accepts. Pass `opts.posterImageUrl` (an absolute
 * http(s) URL) when a spec needs the poster to actually RENDER an `<img>` on the
 * published page (the #266 render-coverage spec) rather than just publish clean.
 */
export function buildDuplicatedLandingConfig(
  prefix: string,
  opts: { posterImageUrl?: string | null } = {},
): SavedLandingDto {
  const base = buildKucyShapedConfig(prefix);
  const posterImageUrl = opts.posterImageUrl ?? null;
  const passes: DisplayPass[] = [
    { id: 'party', name: `${prefix}Party Pass`, price: '€15', description: 'Evening party only' },
    { id: 'full', name: `${prefix}Full Pass`, price: '€30', featured: true, badge: 'Best Value', description: 'Workshops + parties' },
    { id: 'garden', name: `${prefix}Garden Pass`, price: '€20', description: 'Garden room access' },
  ];
  const posters: DisplayPoster[] = [
    { id: 'poster-1', title: `${prefix}Main Poster`, imageUrl: posterImageUrl, downloadUrl: null },
  ];
  // Build config as a variable first so the extra display keys are carried
  // structurally (a nested object LITERAL would trip TS excess-property checks).
  const config = { ...base.config, passes, posters };
  return { template: base.template, config };
}

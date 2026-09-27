/**
 * KEFI-PEOPLE-1 "Organizer people editor" — the request layer of the two acceptance
 * specs (`kefi-landing-people.spec.ts`, `kefi-landing-upload.spec.ts`).
 *
 * Every call goes through the Playwright `request` fixture against the kefi-api host
 * (`KEFI_API_URL`) with a ROPC bearer of the fixture user. It returns the raw
 * `APIResponse` for writes so the spec asserts the status itself.
 *
 * NOT COVERED: these requests are hand-assembled. They test the server contract; the
 * kefi-web editor's own write shape is pinned by `expectJsonWriteShape` in kefi-web.
 */

import type { APIRequestContext, APIResponse, Browser } from '@playwright/test';

import type { KefiAdminClient } from './kefiAdminClient.js';
import type { EphemeralKefiUser } from './kefiKeycloakAdmin.js';
import { KEFI_LANDING_CONFIG_PATH, KEFI_LANDING_UPLOAD_PATH, publicTenantPath } from './kefiLandingPeopleFixture.js';
import { getKefiUrls } from './kefiUrls.js';

export interface PhotoPosition { x: number; y: number; scale: number }
export interface Person {
  id: string;
  name: string;
  role?: string;
  topic?: string;
  photoUrl?: string;
  photoPosition?: PhotoPosition;
  socials?: Array<{ id: string; kind: string; label: string; url: string }>;
}
export interface PerformerGroup { key: string; title?: string; eyebrow?: string; performers: Person[] }
export interface Poster { id: string; title: string; imageUrl?: string }
export interface PublicLanding { performerGroups?: PerformerGroup[]; posters?: Poster[] }
export interface ImageFile { name: string; mimeType: string; buffer: Buffer }

type Json = Record<string, unknown>;

const api = (path: string): string => `${getKefiUrls().apiUrl}${path}`;
const auth = (bearer: string): Record<string, string> => ({ Authorization: `Bearer ${bearer}` });

/** ROPC bearer of a fixture user (organizer, ambassador …) in the kefi realm. */
export function bearerFor(admin: KefiAdminClient, user: EphemeralKefiUser): Promise<string> {
  return admin.getTenantOwnerBearer({ email: user.username, password: user.password });
}

/** The caller tenant's saved landing (GET admin), or an empty one on a fresh tenant. */
async function savedLanding(request: APIRequestContext, bearer: string): Promise<Json> {
  const resp = await request.get(api(KEFI_LANDING_CONFIG_PATH), { headers: auth(bearer) });
  if (resp.status() !== 200) return {};
  return ((await resp.json()) as Json | null) ?? {};
}

/**
 * Full-replace PUT of the landing config: the tenant's current config with `patch`
 * laid over it (the endpoint replaces the whole document, so the rest must be sent back).
 */
export async function putLandingPatch(
  request: APIRequestContext,
  bearer: string,
  patch: Partial<PublicLanding>,
): Promise<APIResponse> {
  const saved = await savedLanding(request, bearer);
  const config = { ...((saved.config as Json | undefined) ?? {}), ...patch };
  const body: Json = { config };
  if (saved.schemaVersion !== undefined) body.schemaVersion = saved.schemaVersion;
  if (saved.template !== undefined) body.template = saved.template;
  return request.put(api(KEFI_LANDING_CONFIG_PATH), { headers: auth(bearer), data: body });
}

/** Anonymous public read: the `landing` object of `GET /api/v1/t/{slug}`. */
export async function publicLanding(request: APIRequestContext, slug: string): Promise<PublicLanding> {
  const resp = await request.get(api(publicTenantPath(slug)));
  if (resp.status() !== 200) {
    throw new Error(`public GET ${publicTenantPath(slug)} expected 200, got ${resp.status()}: ${await resp.text()}`);
  }
  const body = (await resp.json()) as { landing?: PublicLanding | null };
  return body.landing ?? {};
}

/** Multipart POST to the Kefi landing-image upload endpoint. */
export function uploadImage(request: APIRequestContext, bearer: string, file: ImageFile): Promise<APIResponse> {
  return request.post(api(KEFI_LANDING_UPLOAD_PATH), { headers: auth(bearer), multipart: { file } });
}

export function groupByKey(landing: PublicLanding, key: string): PerformerGroup | undefined {
  return landing.performerGroups?.find((g) => g.key === key);
}

/** PNG colour type 4 or 6 carries an alpha channel; a tRNS chunk carries palette/key alpha. */
export function pngKeepsAlpha(bytes: Buffer): boolean {
  const PNG_SIG = '89504e470d0a1a0a';
  const COLOUR_TYPE_OFFSET = 25;
  const GREY_ALPHA = 4;
  const RGBA = 6;
  if (bytes.subarray(0, 8).toString('hex') !== PNG_SIG) return false;
  const colourType = bytes[COLOUR_TYPE_OFFSET];
  return colourType === GREY_ALPHA || colourType === RGBA || bytes.includes(Buffer.from('tRNS'));
}

/**
 * Real encoder output, no binary fixtures: a canvas in a blank page draws a half-transparent
 * PNG and an opaque flier JPEG. The browser is only an image encoder here.
 */
export async function makeTestImages(browser: Browser): Promise<{ png: ImageFile; jpeg: ImageFile }> {
  const page = await browser.newPage();
  try {
    const [pngB64, jpegB64] = await page.evaluate(() => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(200, 40, 40, 1)';
      ctx.fillRect(0, 0, size / 2, size);
      const png = canvas.toDataURL('image/png');
      ctx.fillStyle = 'rgb(20, 20, 120)';
      ctx.fillRect(0, 0, size, size);
      const jpeg = canvas.toDataURL('image/jpeg', 0.9);
      return [png.split(',')[1], jpeg.split(',')[1]];
    });
    return {
      png: { name: 'person.png', mimeType: 'image/png', buffer: Buffer.from(pngB64, 'base64') },
      jpeg: { name: 'flier.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegB64, 'base64') },
    };
  } finally {
    await page.close();
  }
}

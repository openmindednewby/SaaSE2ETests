import type { APIRequestContext } from '@playwright/test';

import { getKefiUrls } from './kefiUrls.js';

export interface PriceWindow {
  externalId: string;
  priceEur: number;
  effectiveFromUtc: string | null;
  effectiveUntilUtc: string | null;
  label: string | null;
  minPaidCount: number | null;
}

export interface TimelinePass {
  code: string;
  currentPriceEur: number;
  currentPriceSource: string;
}

export interface PriceTimeline {
  eventExternalId: string;
  passes: TimelinePass[];
}

export interface WindowReplacement {
  closed: PriceWindow;
  added: PriceWindow;
}

export interface PassRef {
  bearer: string;
  eventExternalId: string;
  passExternalId: string;
}

const OK_MIN = 200;
const OK_MAX = 299;

function windowsPath(ref: PassRef): string {
  return `${getKefiUrls().apiUrl}/api/v1/organizer/events/${ref.eventExternalId}/passes/${ref.passExternalId}/price-windows`;
}

function auth(ref: PassRef): Record<string, string> {
  return { Authorization: `Bearer ${ref.bearer}` };
}

async function expectOk(resp: { status(): number; text(): Promise<string> }, what: string): Promise<void> {
  if (resp.status() < OK_MIN || resp.status() > OK_MAX) {
    throw new Error(`[kefiPriceWindowClient] ${what} expected 2xx, got ${resp.status()}: ${await resp.text()}`);
  }
}

function bodyOf(window: PriceWindow, effectiveUntilUtc: string | null): Record<string, unknown> {
  return {
    priceEur: window.priceEur,
    effectiveFromUtc: window.effectiveFromUtc,
    effectiveUntilUtc,
    label: window.label,
    minPaidCount: window.minPaidCount,
  };
}

/** Second-precision UTC instant ending in `Z`. */
export function utcNowIso(offsetMs = 0): string {
  return `${new Date(Date.now() + offsetMs).toISOString().slice(0, 19)}Z`;
}

export function isCurrent(window: PriceWindow, atMs: number): boolean {
  const from = window.effectiveFromUtc === null ? -Infinity : Date.parse(window.effectiveFromUtc);
  const until = window.effectiveUntilUtc === null ? Infinity : Date.parse(window.effectiveUntilUtc);
  return from <= atMs && atMs < until;
}

export async function listWindows(request: APIRequestContext, ref: PassRef): Promise<PriceWindow[]> {
  const resp = await request.get(windowsPath(ref), { headers: auth(ref) });
  await expectOk(resp, 'list price windows');
  const data = (await resp.json()) as PriceWindow[] | { windows?: PriceWindow[]; items?: PriceWindow[] };
  return Array.isArray(data) ? data : data.windows ?? data.items ?? [];
}

export async function addWindow(
  request: APIRequestContext, ref: PassRef, window: Omit<PriceWindow, 'externalId'>,
): Promise<PriceWindow> {
  const resp = await request.post(windowsPath(ref), { headers: auth(ref), data: window });
  await expectOk(resp, 'create price window');
  return (await resp.json()) as PriceWindow;
}

export async function setWindowUntil(
  request: APIRequestContext, ref: PassRef, window: PriceWindow, effectiveUntilUtc: string | null,
): Promise<void> {
  const resp = await request.put(`${windowsPath(ref)}/${window.externalId}`, {
    headers: auth(ref),
    data: bodyOf(window, effectiveUntilUtc),
  });
  await expectOk(resp, 'update price window');
}

export async function deleteWindow(request: APIRequestContext, ref: PassRef, windowExternalId: string): Promise<void> {
  const resp = await request.delete(`${windowsPath(ref)}/${windowExternalId}`, { headers: auth(ref) });
  await expectOk(resp, 'delete price window');
}

/** The organizer's move: end the current window at `switchAtUtc` (default now) and open a new one from then at `newPriceEur`. */
export async function replaceCurrentWindow(
  request: APIRequestContext, ref: PassRef, current: PriceWindow, newPriceEur: number, switchAtUtc: string = utcNowIso(),
): Promise<WindowReplacement> {
  await setWindowUntil(request, ref, current, switchAtUtc);
  const added = await addWindow(request, ref, {
    priceEur: newPriceEur,
    effectiveFromUtc: switchAtUtc,
    effectiveUntilUtc: current.effectiveUntilUtc,
    label: null,
    minPaidCount: null,
  });
  return { closed: current, added };
}

/** Undoes {@link replaceCurrentWindow}: drops the added window and gives the closed one back its end. */
export async function restoreWindow(request: APIRequestContext, ref: PassRef, replacement: WindowReplacement): Promise<void> {
  await deleteWindow(request, ref, replacement.added.externalId);
  await setWindowUntil(request, ref, replacement.closed, replacement.closed.effectiveUntilUtc);
}

export async function getPriceTimeline(request: APIRequestContext, slug: string): Promise<PriceTimeline> {
  const resp = await request.get(`${getKefiUrls().apiUrl}/api/v1/t/${encodeURIComponent(slug)}/price-timeline`);
  await expectOk(resp, 'price timeline');
  return (await resp.json()) as PriceTimeline;
}

export function timelinePrice(timeline: PriceTimeline, code: string): number | undefined {
  return timeline.passes.find((p) => p.code === code)?.currentPriceEur;
}

/** The baked `.price-tag` text of the tier named `tierName` in the served landing HTML. */
export async function bakedPriceTag(request: APIRequestContext, siteUrl: string, tierName: string): Promise<string | null> {
  const resp = await request.get(`${siteUrl.replace(/\/$/, '')}/?nocache=${Date.now()}`);
  await expectOk(resp, 'landing page');
  const html = await resp.text();
  const escaped = tierName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`class="price-name"[^>]*>${escaped}</div>\\s*<div class="price-tag"[^>]*>([^<]*)<`).exec(html);
  return match ? match[1].trim() : null;
}

export interface ServedSample {
  atUtc: string;
  price: string | null;
  status: number;
  cacheControl: string | null;
  age: string | null;
  etag: string | null;
  lastModified: string | null;
}

/** The served `.price-tag` of `tierName` with the response cache headers, for publish evidence. */
export async function servedSample(request: APIRequestContext, siteUrl: string, tierName: string): Promise<ServedSample> {
  const resp = await request.get(`${siteUrl.replace(/\/$/, '')}/?nocache=${Date.now()}`);
  const html = await resp.text();
  const escaped = tierName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`class="price-name"[^>]*>${escaped}</div>\\s*<div class="price-tag"[^>]*>([^<]*)<`).exec(html);
  const h = resp.headers();
  return {
    atUtc: new Date().toISOString(), price: match ? match[1].trim() : null, status: resp.status(),
    cacheControl: h['cache-control'] ?? null, age: h['age'] ?? null, etag: h['etag'] ?? null, lastModified: h['last-modified'] ?? null,
  };
}

/** The pass entry for `code` in the public landing API (`GET /t/{slug}`), raw, for publish evidence. */
export async function landingApiPass(request: APIRequestContext, slug: string, code: string): Promise<unknown> {
  const resp = await request.get(`${getKefiUrls().apiUrl}/api/v1/t/${encodeURIComponent(slug)}`);
  const body = (await resp.json().catch(() => null)) as { passes?: Array<{ code?: string }> } | null;
  return { status: resp.status(), pass: body?.passes?.find((p) => p.code === code) ?? null };
}

import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

export const PROTECTED_TENANT_SLUGS: readonly string[] = [
  'ubb',
  'csdf',
  'cdf',
  'ubs',
  'kucy',
  'kizomba-union-cy',
  'kizombaunioncy',
  'united-by-salsa',
  'unitedbybachata',
  'demo',
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const KEFI_HOST_RE = /(^|\.)(kefi|kizombaunioncy)\.dloizides\.com$/;
const DLOIZIDES_HOST_RE = /(^|\.)dloizides\.com$/;
const PATCHED = Symbol.for('e2e.real-tenant-guard.patched');
const REFUSAL = 'REFUSING TEST WRITE ON A REAL TENANT';

interface RouteLike {
  request(): { method(): string; url(): string };
  abort(code?: string): Promise<void>;
  fallback(): Promise<void>;
}

interface ContextLike {
  route(matcher: (url: URL) => boolean, handler: (route: RouteLike) => Promise<void>): Promise<void>;
}

interface FetchOptions {
  url?: string;
  method?: string;
  request?: { url(): string; method(): string };
}

function isProtected(slug: string | undefined): slug is string {
  return slug !== undefined && PROTECTED_TENANT_SLUGS.includes(slug);
}

export function protectedTenantOf(rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const firstLabel = host.split('.')[0];
  const kefiHost = KEFI_HOST_RE.test(host);
  const hostSlugCounts = kefiHost || (DLOIZIDES_HOST_RE.test(host) && firstLabel !== 'demo');
  if (hostSlugCounts && isProtected(firstLabel)) return firstLabel;
  if (!kefiHost) return undefined;
  const segments = url.pathname.toLowerCase().split('/');
  const tIndex = segments.indexOf('t');
  const pathSlug = tIndex >= 0 ? segments[tIndex + 1] : undefined;
  return isProtected(pathSlug) ? pathSlug : undefined;
}

export function isRealTenantWrite(method: string, rawUrl: string): boolean {
  return !READ_METHODS.has(method.toUpperCase()) && protectedTenantOf(rawUrl) !== undefined;
}

export function refusalMessage(method: string, rawUrl: string): string {
  return (
    `[real-tenant-guard] ${REFUSAL}: ${method.toUpperCase()} ${rawUrl} targets the protected tenant ` +
    `'${protectedTenantOf(rawUrl)}'. Point the spec at the e2e fixture tenant (KEFI_FIXTURE_TENANT_SLUG). ` +
    `Protected slugs: ${PROTECTED_TENANT_SLUGS.join(', ')}`
  );
}

function failCurrentTest(message: string): void {
  let inTest = true;
  try {
    test.info();
  } catch {
    inTest = false;
  }
  if (!inTest) throw new Error(message);
  expect.soft(message, message).toBe('');
}

async function guardRoute(route: RouteLike): Promise<void> {
  const request = route.request();
  if (!isRealTenantWrite(request.method(), request.url())) {
    await route.fallback();
    return;
  }
  const message = refusalMessage(request.method(), request.url());
  await route.abort('blockedbyclient');
  failCurrentTest(message);
}

function clientModule<T>(file: string): T {
  const root = dirname(require.resolve('playwright-core/package.json'));
  return require(join(root, 'lib', 'client', file)) as T;
}

function patchBrowser(): void {
  const { Browser } = clientModule<{
    Browser: { prototype: { _innerNewContext: (...args: unknown[]) => Promise<ContextLike> } };
  }>('browser.js');
  const original = Browser.prototype._innerNewContext;
  Browser.prototype._innerNewContext = async function patched(this: unknown, ...args: unknown[]) {
    const context = await original.apply(this, args);
    await context.route((url) => protectedTenantOf(url.href) !== undefined, guardRoute);
    return context;
  };
}

function patchApiRequest(): void {
  const { APIRequestContext } = clientModule<{
    APIRequestContext: { prototype: { _innerFetch: (options?: FetchOptions) => Promise<unknown> } };
  }>('fetch.js');
  const original = APIRequestContext.prototype._innerFetch;
  APIRequestContext.prototype._innerFetch = async function patched(this: unknown, options: FetchOptions = {}) {
    const url = options.url ?? options.request?.url() ?? '';
    const method = options.method ?? options.request?.method() ?? 'GET';
    if (isRealTenantWrite(method, url)) throw new Error(refusalMessage(method, url));
    return original.call(this, options);
  };
}

export function installRealTenantWriteGuard(): void {
  const state = globalThis as { [PATCHED]?: boolean };
  if (state[PATCHED]) return;
  patchBrowser();
  patchApiRequest();
  state[PATCHED] = true;
}

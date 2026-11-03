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
const LOGIN_REFUSAL = 'REFUSING TEST LOGIN ON A REAL TENANT';
const BFF_LOGIN_PATH = '/bff/login';
const BFF_SESSION_PROBE_PATH = '/bff/api/kefi/api/v1/admin/landing-config';
const API_SESSION_PROBE_PATH = '/api/v1/admin/landing-config';
const SESSION_TENANT_PATH_SUFFIX = '/admin/landing-config';
const HTTP_OK = 200;

interface RouteLike {
  request(): { method(): string; url(): string };
  abort(code?: string): Promise<void>;
  fallback(): Promise<void>;
}

interface HttpReply {
  ok(): boolean;
  url(): string;
  json(): Promise<unknown>;
}

interface ResponseLike extends HttpReply {
  request(): { method(): string };
}

interface ContextLike {
  route(matcher: (url: URL) => boolean, handler: (route: RouteLike) => Promise<void>): Promise<void>;
  on(event: 'response', listener: (response: ResponseLike) => void): unknown;
  request: { get(url: string): Promise<HttpReply> };
  clearCookies(): Promise<void>;
}

interface BearerProbeClient {
  get(
    url: string,
    config: { headers: Record<string, string>; validateStatus: () => boolean },
  ): Promise<{ status: number; data: unknown }>;
}

interface FetchOptions {
  url?: string;
  method?: string;
  request?: { url(): string; method(): string };
}

export function loginRefusalMessage(slug: string, source: string): string {
  return (
    `[real-tenant-guard] ${LOGIN_REFUSAL}: ${source} signed in to the protected tenant '${slug}'. ` +
    'Sign in as the e2e fixture organizer (KEFI_FIXTURE_ORGANIZER_USERNAME), reads included.'
  );
}

class RealTenantLoginRefusal extends Error {
  constructor(
    readonly slug: string,
    source: string,
  ) {
    super(loginRefusalMessage(slug, source));
  }
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

function pathOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return '';
  }
}

export function realTenantOfSession(body: unknown): string | undefined {
  const slug = (body as { tenantSlug?: unknown } | null)?.tenantSlug;
  if (typeof slug !== 'string') return undefined;
  const normalized = slug.trim().toLowerCase();
  return isProtected(normalized) ? normalized : undefined;
}

async function tenantOfReply(reply: HttpReply): Promise<string | undefined> {
  if (!reply.ok()) return undefined;
  return realTenantOfSession(await reply.json().catch(() => undefined));
}

async function realTenantBehindReply(
  method: string,
  reply: HttpReply,
  get: (url: string) => Promise<HttpReply>,
): Promise<string | undefined> {
  const verb = method.toUpperCase();
  const url = reply.url();
  const path = pathOf(url);
  if (verb === 'GET' && path.endsWith(SESSION_TENANT_PATH_SUFFIX)) return tenantOfReply(reply);
  if (verb !== 'POST' || path !== BFF_LOGIN_PATH || !reply.ok()) return undefined;
  try {
    return await tenantOfReply(await get(new URL(BFF_SESSION_PROBE_PATH, url).href));
  } catch (error) {
    if (error instanceof RealTenantLoginRefusal) return error.slug;
    return undefined;
  }
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

export const loginRefusalSink = { fail: failCurrentTest };

async function guardSessionResponse(context: ContextLike, response: ResponseLike): Promise<void> {
  const get = (url: string): Promise<HttpReply> => context.request.get(url);
  const slug = await realTenantBehindReply(response.request().method(), response, get);
  if (slug === undefined) return;
  await context.clearCookies().catch(() => undefined);
  loginRefusalSink.fail(loginRefusalMessage(slug, response.url()));
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
    context.on('response', (response) => void guardSessionResponse(context, response));
    return context;
  };
}

function patchApiRequest(): void {
  const { APIRequestContext } = clientModule<{
    APIRequestContext: { prototype: { _innerFetch: (options?: FetchOptions) => Promise<HttpReply> } };
  }>('fetch.js');
  const original = APIRequestContext.prototype._innerFetch;
  APIRequestContext.prototype._innerFetch = async function patched(
    this: { get(url: string): Promise<HttpReply> },
    options: FetchOptions = {},
  ) {
    const url = options.url ?? options.request?.url() ?? '';
    const method = options.method ?? options.request?.method() ?? 'GET';
    if (isRealTenantWrite(method, url)) throw new Error(refusalMessage(method, url));
    const reply = await original.call(this, options);
    if (options.request) return reply;
    const slug = await realTenantBehindReply(method, reply, (probeUrl) => this.get(probeUrl));
    if (slug !== undefined) throw new RealTenantLoginRefusal(slug, reply.url());
    return reply;
  };
}

export async function refuseRealTenantBearer(client: BearerProbeClient, bearer: string): Promise<string> {
  const config = { headers: { Authorization: `Bearer ${bearer}` }, validateStatus: () => true };
  const reply = await client.get(API_SESSION_PROBE_PATH, config).catch(() => undefined);
  const slug = reply?.status === HTTP_OK ? realTenantOfSession(reply.data) : undefined;
  if (slug !== undefined) throw new RealTenantLoginRefusal(slug, 'a tenant-owner bearer');
  return bearer;
}

export function installRealTenantWriteGuard(): void {
  const state = globalThis as { [PATCHED]?: boolean };
  if (state[PATCHED]) return;
  patchBrowser();
  patchApiRequest();
  state[PATCHED] = true;
}

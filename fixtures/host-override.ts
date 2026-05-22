/**
 * Host-override mechanism — eliminates the operator hosts-file edit when
 * targeting environments whose public DNS doesn't point at the cluster the
 * tests actually need to hit (notably `E2E_TARGET=staging`, where
 * `*.dloizides.com` public DNS resolves to PROD).
 *
 * Two halves:
 *
 * 1. Node-side (this file): monkey-patches `dns.lookup` + `dns.promises.lookup`
 *    so that hostnames matching `E2E_HOST_OVERRIDE_PATTERN` (regex, default
 *    `^staging\.[a-z0-9-]+\.dloizides\.com$`) resolve to
 *    `E2E_HOST_OVERRIDE_IP`. Used by `APIRequestContext`, axios in
 *    `helpers/auth-helper.ts`, the global-setup `fetch()` probe, and anything
 *    else that ends up in `node:http`/`undici`.
 *
 * 2. Chromium-side (`playwright.config.ts`): use `chromiumHostResolverRules()`
 *    to build the `--host-resolver-rules` launch arg. Same env vars apply.
 *
 * Both halves no-op when `E2E_HOST_OVERRIDE_IP` is unset, so local / prod
 * targets are unaffected.
 *
 * Idempotent: `installHostOverride()` only patches once per process. A second
 * call is a no-op.
 *
 * NOTE: this file deliberately uses `require('dns')` instead of
 * `import * as dns from 'node:dns'`. The ESM namespace returned by
 * `import * as` is a synthetic object whose top-level bindings are read-only
 * — assigning to `dnsNamespace.lookup` doesn't propagate to the real module.
 * `require('dns')` returns the live module object that everything else in
 * the process (axios's http adapter, undici's fetch, etc.) reads from. The
 * existing patches in the wider Node ecosystem (mock-dns, mitm, etc.) all
 * use this same require-based pattern for the same reason.
 */
// Pull in the namespace for type references (LookupOptions, LookupAddress)
// without affecting runtime — the actual mutable object is fetched via
// require() below. `import type` is erased at compile time.
import type * as dns from 'node:dns';

const dnsRuntime = require('node:dns') as typeof import('node:dns');

const DEFAULT_PATTERN = '^staging\\.[a-z0-9-]+\\.dloizides\\.com$';

const SAAS_STAGING_HOSTNAMES = [
  'staging.app.dloizides.com',
  'staging.identity.dloizides.com',
  'staging.identity-api.dloizides.com',
  'staging.questioner-api.dloizides.com',
  'staging.onlinemenu-api.dloizides.com',
  'staging.content-api.dloizides.com',
  'staging.notification-api.dloizides.com',
  'staging.payment-api.dloizides.com',
  // Per-product web apps (Phase 3 product split) — each is a BFF-fronted SPA
  // on its own host. The Node-side `dns.lookup` patch already covers these via
  // the `^staging\.[a-z0-9-]+\.dloizides\.com$` regex, but Chromium uses its
  // OWN resolver and only honours these explicit `MAP` rules. Omitting them
  // made the browser fall through to public DNS (a CNAME to the PROD IP),
  // which has no `staging.{product}.dloizides.com` ingress → Traefik 404.
  // That 404 was previously misdiagnosed as an erevna-web SPA routing defect.
  'staging.erevna.dloizides.com',
  'staging.katalogos.dloizides.com',
] as const;

const PATCHED_SENTINEL = Symbol.for('e2e.host-override.patched');

interface HostOverrideConfig {
  ip: string;
  pattern: RegExp;
  patternSource: string;
}

function readConfig(): HostOverrideConfig | null {
  const ip = process.env.E2E_HOST_OVERRIDE_IP?.trim();
  if (!ip) return null;

  const patternSource = process.env.E2E_HOST_OVERRIDE_PATTERN?.trim() || DEFAULT_PATTERN;
  let pattern: RegExp;
  try {
    pattern = new RegExp(patternSource);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[e2e-host-override] Invalid E2E_HOST_OVERRIDE_PATTERN="${patternSource}": ${message}`,
    );
  }

  return { ip, pattern, patternSource };
}

/**
 * Monkey-patch `dns.lookup` + `dns.promises.lookup` so hostnames matching
 * the configured pattern resolve to the configured override IP.
 *
 * No-op when `E2E_HOST_OVERRIDE_IP` is unset.
 *
 * Idempotent: a second call within the same process is a no-op.
 *
 * @returns `true` if a patch was installed this call, `false` otherwise.
 */
export function installHostOverride(): boolean {
  const config = readConfig();
  if (!config) return false;

  const dnsAny = dnsRuntime as unknown as { [PATCHED_SENTINEL]?: true };
  if (dnsAny[PATCHED_SENTINEL]) return false;
  dnsAny[PATCHED_SENTINEL] = true;

  patchCallback(config);
  patchPromise(config);

  process.stdout.write(
    `[e2e-host-override] active ip=${config.ip} pattern=${config.patternSource}\n`,
  );
  return true;
}

/**
 * Build the Chromium `--host-resolver-rules` value for the configured override.
 * Returns an empty string when no override is configured — caller should
 * skip adding the launch arg in that case.
 *
 * Chromium's `--host-resolver-rules` doesn't take a regex; it takes a
 * comma-separated list of `MAP <hostname-or-pattern> <ip>` rules. We enumerate
 * the eight staging SaaS hostnames the framework knows about. If the caller
 * has set a non-default `E2E_HOST_OVERRIDE_PATTERN` and needs additional
 * hostnames mapped on the Chromium side, they should also set
 * `E2E_HOST_OVERRIDE_HOSTS` (comma-separated). The enumerated list is the
 * default; the env var, if set, REPLACES it.
 */
export function chromiumHostResolverRules(): string {
  const config = readConfig();
  if (!config) return '';

  const explicitHosts = process.env.E2E_HOST_OVERRIDE_HOSTS?.trim();
  const hosts = explicitHosts
    ? explicitHosts.split(',').map(h => h.trim()).filter(Boolean)
    : [...SAAS_STAGING_HOSTNAMES];

  return hosts.map(h => `MAP ${h} ${config.ip}`).join(',');
}

// ---------- internal: callback-style dns.lookup ----------

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;
type LookupAllCallback = (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void;

function patchCallback(config: HostOverrideConfig): void {
  // Use Function.prototype.bind to capture the original; this preserves the
  // overload behavior at runtime (Node dispatches on argument count).
  const original = dnsRuntime.lookup.bind(dnsRuntime) as typeof dns.lookup;

  // We type the replacement as `any` because dns.lookup has five real
  // overloads — replicating them all in TypeScript is noisy and offers no
  // runtime safety. The cast back to `typeof dns.lookup` is the contract.
  const patched = function patchedLookup(
    hostname: string,
    optionsOrCb: dns.LookupOptions | LookupCallback | LookupAllCallback,
    maybeCb?: LookupCallback | LookupAllCallback,
  ): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
    const options: dns.LookupOptions | undefined =
      typeof optionsOrCb === 'function' ? undefined : optionsOrCb;

    if (typeof hostname === 'string' && config.pattern.test(hostname) && typeof callback === 'function') {
      const family = 4;
      if (options && options.all) {
        (callback as LookupAllCallback)(null, [{ address: config.ip, family }]);
      } else {
        (callback as LookupCallback)(null, config.ip, family);
      }
      return;
    }

    return (original as any)(hostname, optionsOrCb, maybeCb);
  } as unknown as typeof dns.lookup;

  // Preserve the non-enumerable __promisify__ symbol Node ships on dns.lookup,
  // since `dns.promises.lookup` is implemented via util.promisify under the hood
  // in some Node versions.
  (patched as any)[Symbol.for('nodejs.util.promisify.custom')] = (dnsRuntime.lookup as any)[
    Symbol.for('nodejs.util.promisify.custom')
  ];

  (dnsRuntime as any).lookup = patched;
}

// ---------- internal: dns.promises.lookup ----------

function patchPromise(config: HostOverrideConfig): void {
  const original = dnsRuntime.promises.lookup.bind(dnsRuntime.promises) as typeof dns.promises.lookup;

  const patched = async function patchedPromisesLookup(
    hostname: string,
    options?: number | dns.LookupOptions,
  ): Promise<dns.LookupAddress | dns.LookupAddress[]> {
    if (typeof hostname === 'string' && config.pattern.test(hostname)) {
      const family = 4;
      const opts = typeof options === 'object' ? options : undefined;
      const result: dns.LookupAddress = { address: config.ip, family };
      if (opts && opts.all) return [result];
      return result;
    }
    return (original as any)(hostname, options);
  } as unknown as typeof dns.promises.lookup;

  (dnsRuntime.promises as any).lookup = patched;
}

export const _internals = {
  SAAS_STAGING_HOSTNAMES,
  DEFAULT_PATTERN,
  readConfig,
};

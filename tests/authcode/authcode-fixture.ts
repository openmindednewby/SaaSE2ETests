/**
 * Ephemeral in-process HTTP fixtures for `authcode-negative-control.spec.ts`.
 *
 * These are NOT dev servers and must never become any: they bind an ephemeral
 * port on 127.0.0.1, answer a handful of requests, and are closed in the same
 * test that started them. Nothing outside the test process can reach them and
 * nothing survives it. (Long-lived servers in this repo are Tilt resources — see
 * CLAUDE.md; that rule is about not duplicating a Tilt-managed dev server, which
 * this deliberately is not.)
 *
 * They exist so the guard can be WATCHED TO FAIL on every run rather than once,
 * by hand, at the moment it was written.
 */
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const HTTP_OK = 200;
const HTTP_FOUND = 302;
const HTTP_NOT_FOUND = 404;
const HTTP_NOT_IMPLEMENTED = 501;
const LOOPBACK = '127.0.0.1';

const DISCOVERY_SUFFIX = '/.well-known/openid-configuration';
const KEYCLOAK_AUTHORIZE_SUFFIX = '/protocol/openid-connect/auth';

/** A started fixture: its base URL, and the close that must run in a `finally`. */
export interface Fixture {
  readonly baseUrl: string;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function start(handler: RequestListener): Promise<Fixture> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://${LOOPBACK}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A minimal identity provider: it serves ONE thing, the discovery document, and
 * reports its own origin as the issuer — exactly what a real provider pinned by
 * `KC_HOSTNAME` does.
 */
export async function startIdp(realm: string): Promise<Fixture & { issuer: string }> {
  const fixture = await start((request: IncomingMessage, response: ServerResponse) => {
    if ((request.url ?? '').endsWith(DISCOVERY_SUFFIX)) {
      const origin = `http://${request.headers.host}`;
      json(response, HTTP_OK, { issuer: `${origin}/realms/${realm}` });
      return;
    }
    json(response, HTTP_NOT_FOUND, { error: 'not found' });
  });
  return { ...fixture, issuer: `${fixture.baseUrl}/realms/${realm}` };
}

/** How the fake BFF should answer — one knob per failure mode under test. */
export interface BffFixtureOptions {
  /** Value of `issuer` on `GET /bff/config` (the BACK channel). */
  readonly backIssuer: string | null;
  /** Value of `issuerStatus`; `undefined` omits the field (pre-1.16.0 shape). */
  readonly issuerStatus?: string;
  /** Origin the front-channel 302 points at (the FRONT channel). */
  readonly frontOrigin: string;
  /** Realm segment used to build the authorize path. */
  readonly realm: string;
  /**
   * When false, `methods` omits passkey — the BFF advertises no passkey login at
   * all, so there is no anonymous front-channel navigation to probe.
   */
  readonly advertisesPasskey?: boolean;
  /**
   * When false, `GET /bff/passkey/login` answers 501. Deliberately INDEPENDENT of
   * `advertisesPasskey`: the probe has two distinct "cannot check" exits and
   * collapsing them into one knob left the 501 exit with no coverage — a mutation
   * that deleted it kept the suite green. Two knobs, two cases, both watched.
   */
  readonly passkeyEndpointEnabled?: boolean;
}

/** A minimal BFF: `GET /bff/config` and the anonymous front-channel 302. */
export async function startBff(options: BffFixtureOptions): Promise<Fixture> {
  const advertisesPasskey = options.advertisesPasskey ?? true;
  const passkeyEndpointEnabled = options.passkeyEndpointEnabled ?? true;
  const methods = advertisesPasskey ? ['password', 'passkey'] : ['password'];

  return start((request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? '';

    if (url.startsWith('/bff/config')) {
      const body: Record<string, unknown> = { methods, issuer: options.backIssuer };
      if (options.issuerStatus !== undefined) body.issuerStatus = options.issuerStatus;
      json(response, HTTP_OK, body);
      return;
    }

    if (url.startsWith('/bff/passkey/login')) {
      if (!passkeyEndpointEnabled) {
        json(response, HTTP_NOT_IMPLEMENTED, { error: 'Passkey login is not enabled for this BFF.' });
        return;
      }
      const authorize =
        `${options.frontOrigin}/realms/${options.realm}${KEYCLOAK_AUTHORIZE_SUFFIX}` +
        '?client_id=fixture-client&response_type=code';
      response.writeHead(HTTP_FOUND, { Location: authorize });
      response.end();
      return;
    }

    json(response, HTTP_NOT_FOUND, { error: 'not found' });
  });
}

/** Runs `body` with every fixture closed afterwards, pass or fail. */
export async function withFixtures<T>(fixtures: Fixture[], body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } finally {
    for (const fixture of fixtures) {
      await fixture.close();
    }
  }
}

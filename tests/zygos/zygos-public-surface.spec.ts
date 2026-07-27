// Zygos PUBLIC SURFACE (ZY-23) — everything an anonymous stranger can reach, and everything we
// deliberately publish about how to get in.
//
// ── Why this file exists ──────────────────────────────────────────────────────────────────────
//
// Every other spec in this suite authenticates first. This one never does — it is the only place
// that asks "what does the internet see?". Two independent things landed here because they are
// the same question:
//
//  1. We PUBLISH a working credential on a marketing website, on purpose, so an evaluator can try
//     the product without a sales call. A published credential is a CLAIM, and every other claim
//     on that page is tested. This one was not.
//
//  2. Publishing it drives public traffic at the login page — which makes every other anonymous
//     endpoint on that origin a thing we are now inviting people to find.
//
// ── The drift this exists to catch ────────────────────────────────────────────────────────────
//
// 🔴 ONE password, TWO sources of truth, and NOTHING connected them:
//
//     zygos/landing/src/data/site.ts   DEMO.password   → printed on finreg.dloizides.com
//     Bff__Demo__Password (k8s env)    → served by GET /bff/config → shown on the login page
//
// Rotate either one alone and the marketing site keeps confidently printing a password that no
// longer works. That failure is SILENT, public, and lands on the exact visitor we most wanted to
// impress. It is the house failure mode — "config that looks authoritative and never reaches the
// runtime" — pointed at a customer instead of a server.
//
// There is no clever way to make one file import the other: the landing site is a static Astro
// build and the credential is k8s config. So the join has to be a TEST, and this is it.
import { expect, test } from '@playwright/test';

import { retryWhileRateLimited } from '../../helpers/rate-limit.js';
import { ZYGOS_TEST_PASSWORD, ZYGOS_WEB_URL, bodyText, bodyJson, jsonCsrfHeaders } from './zygos-helpers.js';

/** The marketing site that PRINTS the demo credential to the public. */
const ZYGOS_MARKETING_URL = (process.env.ZYGOS_MARKETING_URL?.trim() || 'https://finreg.dloizides.com').replace(
  /\/+$/,
  '',
);

/** The shape `GET /bff/config` returns (Bff.AspNetCore 1.10.0). `demo` is null when unconfigured. */
interface BffConfig {
  registrationEnabled: boolean;
  demo: { publishedUsername: string; publishedPassword: string } | null;
}

async function fetchConfig(request: import('@playwright/test').APIRequestContext): Promise<BffConfig> {
  const res = await request.get(`${ZYGOS_WEB_URL}/bff/config`);
  expect(res.status(), `GET /bff/config failed: ${await bodyText(res)}`).toBe(200);
  const config = await bodyJson<BffConfig>(res);
  expect(config, 'GET /bff/config returned a non-JSON body').not.toBeNull();
  return config as BffConfig;
}

test.describe('Zygos public surface @zygos-api @api', () => {
  test('🔴 the credential the login page advertises actually logs in', async ({ request }) => {
    const config = await fetchConfig(request);

    // If this is null the demo is simply off — that is a legitimate deployment (fail closed by
    // omission), but NOT a legitimate state for the deployment we point the public at.
    expect(
      config.demo,
      'GET /bff/config carries no demo block ⇒ the login page shows no credentials. Either Bff__Demo__* is unset on bff-zygos, or the BFF is older than Bff.AspNetCore 1.10.0.',
    ).not.toBeNull();

    const demo = config.demo as NonNullable<BffConfig['demo']>;

    // 🔴 THE ASSERTION THAT MATTERS. Not "a demo user exists" — that would pass while the page
    // showed a stale password. This logs in with THE EXACT STRINGS the page hands the visitor.
    //
    // Retried on 429 for the same reason as the shared-password probe below: `/bff/login` is rate
    // limited 5/60s per IP, and an un-retried 429 fails this with "the credentials advertised on
    // the login page DO NOT WORK" — an alarming, wrong conclusion drawn from an empty body. A
    // request still 429 after all retries surfaces as a real failure, so nothing is masked.
    const res = await retryWhileRateLimited(
      'zygos advertised demo credential /bff/login',
      () =>
        request.post(`${ZYGOS_WEB_URL}/bff/login`, {
          headers: jsonCsrfHeaders(),
          data: { username: demo.publishedUsername, password: demo.publishedPassword },
        }),
      (r) => r.status(),
    );
    expect(
      res.status(),
      `The credentials advertised on the login page DO NOT WORK — every visitor sent to the demo is bounced. body: ${await bodyText(res)}`,
    ).toBe(200);
  });

  test('🔴 the password PRINTED on the marketing site is the one the console serves', async ({ request }) => {
    const config = await fetchConfig(request);
    const demo = config.demo as NonNullable<BffConfig['demo']>;
    test.skip(demo === null, 'demo not configured');

    const page = await request.get(`${ZYGOS_MARKETING_URL}/`);
    expect(page.status(), `marketing site unreachable: ${await bodyText(page)}`).toBe(200);
    const html = await page.text();

    // Substring, deliberately — NOT a regex that parses the password out of the copy. The
    // invariant is "the working password appears on the page", and that survives someone
    // rewording the FAQ around it. A regex would go green on a reword and red on nothing.
    expect(
      html.includes(demo.publishedPassword),
      `finreg.dloizides.com does not print the password the console actually accepts. One of the two was rotated without the other, and the public page is now lying to every visitor.`,
    ).toBe(true);

    expect(
      html.includes(demo.publishedUsername),
      'the marketing page does not print the demo username the console serves',
    ).toBe(true);
  });

  test('🔴 the SHARED platform password is not what got published', async ({ request }) => {
    // The demo user is deliberately NOT in realms.config.json's testUsers, because the seeder sets
    // every one of those to a SINGLE platform-wide KEYCLOAK_TEST_USER_PASSWORD shared across all
    // ten realms. Adding `demo` there would silently reset it to that value on the next
    // re-provision — and this page publishes it, so the reset would publish a working credential
    // for every product on the estate.
    //
    // This test is what makes that reversible mistake loud. It fails the moment someone "tidies"
    // the demo user into testUsers.
    const config = await fetchConfig(request);
    const demo = config.demo as NonNullable<BffConfig['demo']>;
    test.skip(demo === null, 'demo not configured');

    expect(demo.publishedPassword, 'the PUBLISHED demo password is the shared platform password').not.toBe(
      ZYGOS_TEST_PASSWORD,
    );

    // 🔴 THIS PROBE MUST RETRY ON 429, AND THE REASON IS THE ASSERTION BELOW.
    //
    // `/bff/login` is rate limited (5/60s per IP). This spec sits downstream of the login-heavy
    // zygos-auth suite, so in a full sweep the limiter routinely answers 429 here — with an EMPTY
    // body. A bare `.toBe(401)` then fails, and the message it prints is the most alarming one in
    // the file: "the estate-wide credential is now effectively public". That is a FALSE ALARM on a
    // security-critical assertion, and a security test that cries wolf is a security test people
    // learn to skip. Observed 2026-07-19: failed in-sweep with 429/empty body, passed in isolation
    // seconds later against the same unchanged deployment.
    //
    // Retrying does NOT weaken the guard: `retryWhileRateLimited` surfaces a request that is STILL
    // 429 after all attempts as a real failure, so a genuinely broken limiter is never masked. The
    // strict `.toBe(401)` is deliberately KEPT — the point is to get a real answer from the server
    // before judging it, not to accept a wider range of answers.
    const res = await retryWhileRateLimited(
      'zygos demo user vs shared platform password /bff/login',
      () =>
        request.post(`${ZYGOS_WEB_URL}/bff/login`, {
          headers: jsonCsrfHeaders(),
          data: { username: demo.publishedUsername, password: ZYGOS_TEST_PASSWORD },
        }),
      (r) => r.status(),
    );
    expect(
      res.status(),
      `the demo user accepts the shared platform password ⇒ it was swept back into testUsers and the estate-wide credential is now effectively public. body: ${await bodyText(res)}`,
    ).toBe(401);
  });

  test('🔴 strangers cannot self-provision a tenant on a payments back-office', async ({ request }) => {
    // Zygos is sold, not signed up for — its own marketing FAQ says so. Registration was live here
    // purely because `Bff:TenantProxy:TenantServiceUpstream` was set: ONE plumbing value ("where
    // does tenant-api live") silently decided a PRODUCT question nobody had been asked.
    //
    // The naive fix — deleting TenantProxy — is a trap: /bff/otp/request takes BffTenantProxyClient
    // as a handler parameter, so removing the upstream breaks OTP login at DI resolution. Hence an
    // explicit `Bff:Registration:Enabled=false` (Bff.AspNetCore 1.10.0), set in Bff.Zygos's
    // appsettings.json because it is a permanent truth about the PRODUCT, not about this box.
    //
    // 🔴 This test is that config's only guard. appsettings.json carries no comment explaining the
    // line (nothing in this repo comments appsettings, and .NET's tolerance for it is unproven
    // here), so a future reader sees a bare `"Registration": {"Enabled": false}` next to a
    // perfectly good TenantProxy upstream and deletes it as dead config. This goes red when they do.
    const config = await fetchConfig(request);
    expect(
      config.registrationEnabled,
      'the console ADVERTISES self-serve registration — Bff:Registration:Enabled=false is missing from Bff.Zygos appsettings, or the BFF predates Bff.AspNetCore 1.10.0',
    ).toBe(false);

    // The advertised capability and the endpoint must never disagree. `registrationEnabled: false`
    // while POST /bff/register still provisions would be the worst of both worlds: a hole nobody
    // is looking at because the config says it is closed.
    const res = await request.post(`${ZYGOS_WEB_URL}/bff/register`, {
      headers: jsonCsrfHeaders(),
      data: {
        username: 'zy23-probe',
        email: 'zy23-probe@example.invalid',
        password: 'Probe12345!',
        firstName: 'Probe',
        lastName: 'Probe',
        tenantName: 'ZY23 Probe',
        verifyUrlTemplate: `${ZYGOS_WEB_URL}/verify?token={token}`,
      },
    });

    // 🔴 A 400 IS NOT PROOF, and this is the whole reason the body is asserted. Before the fix this
    // exact request returned 400 — from the VALIDATOR, having sailed past a wide-open gate. A test
    // that accepted "not 200" would have passed against the live hole. What must NOT come back is a
    // validation schema; anything that names `tenantName` means the request reached the validator,
    // which means registration is still on.
    const body = await bodyText(res);
    expect(res.status(), `self-serve registration is OPEN on the payments console. body: ${body}`).not.toBe(200);
    expect(res.status(), `unexpected register status; body: ${body}`).not.toBe(201);
    expect(
      body.includes('tenantName'),
      `POST /bff/register reached its VALIDATOR ⇒ registration is still enabled; the 4xx is the validator refusing a bad body, not the gate refusing the request. body: ${body}`,
    ).toBe(false);
  });
});

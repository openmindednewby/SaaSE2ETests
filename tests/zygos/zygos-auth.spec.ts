// Zygos auth @api (ZY-18) — login, logout, and the negatives that matter.
//
// The BFF terminates auth server-side: tokens NEVER reach the browser, only the httpOnly
// `__Host-bff-zygos` cookie does. So "am I authenticated" is a question about a cookie, and the
// only honest way to test it is to make the same request with and without one.
//
// ⚠️ This file is the suite's heaviest consumer of the login budget (5 req/60s per IP — see
// zygos-helpers). `test.describe.serial` keeps the burn ordered and predictable; the shared
// cached session is used wherever a fresh one isn't strictly required.
import { expect, test } from '@playwright/test';

import { ZYGOS_API_PREFIX, ZYGOS_USERS, ZYGOS_WEB_URL, bodyText, csrfHeaders, jsonCsrfHeaders } from './zygos-helpers.js';
import { anonymousContext, loginAs, loginFresh, loginOutcome } from './zygos-session.js';

const INSTRUCTIONS = `${ZYGOS_API_PREFIX}/payment-instructions`;
const SKIP_REASON = 'Zygos console unreachable or fixture users not seeded';

test.describe.serial('Zygos auth @zygos-api @api', () => {
  test('🔴 without a session cookie the API is 401 — and with one it is 200', async () => {
    // ── The negative ──────────────────────────────────────────────────────────────────────
    const anon = await anonymousContext();
    const anonRes = await anon.get(INSTRUCTIONS);
    expect(anonRes.status(), `anonymous list must be 401; body: ${await bodyText(anonRes)}`).toBe(401);
    await anon.dispose();

    // ── The discrimination proof ──────────────────────────────────────────────────────────
    // SAME URL, SAME method. Only the cookie differs. Without this leg the 401 above is equally
    // consistent with "the route doesn't exist", "the service is down", or "the BFF 401s
    // everything" — none of which is a working auth wall.
    const session = await loginAs(ZYGOS_USERS.MAKER_A);
    test.skip(!session, SKIP_REASON);

    const authed = await session!.context.get(INSTRUCTIONS);
    expect(authed.status(), `the same request WITH a session must be 200; body: ${await bodyText(authed)}`).toBe(200);
  });

  test('login sets an httpOnly, Secure __Host- session cookie', async () => {
    const session = await loginAs(ZYGOS_USERS.MAKER_A);
    test.skip(!session, SKIP_REASON);

    const state = await session!.context.storageState();
    const bff = state.cookies.find((c) => c.name === '__Host-bff-zygos');

    expect(bff, 'the BFF session cookie must be set on login').toBeTruthy();
    // The `__Host-` prefix is not decoration: browsers enforce Secure + path=/ + no Domain, so a
    // sibling subdomain cannot set or read it. That is why the suite cannot run over plain HTTP.
    expect(bff!.httpOnly, 'the session cookie must be httpOnly — JS must never see it').toBe(true);
    expect(bff!.secure, '__Host- cookies are HTTPS-only by spec').toBe(true);
  });

  test('bad credentials are REJECTED — not merely "no session"', async () => {
    // 🔴 Asserts `rejected` specifically, never just "falsy".
    //
    // A 429 also produces "no session". If this test accepted any failure, it would pass while
    // the server was throttling — i.e. it would be green about a credential check it never
    // reached, which is the same false-green shape as the CSRF/maker-checker confusion. Only
    // `rejected` proves the server looked at the password and said no.
    const outcome = await loginOutcome(ZYGOS_USERS.MAKER_A, 'definitely-not-the-password');
    expect(
      outcome.kind,
      `a wrong password must be REJECTED by the server (got "${outcome.kind}" — "throttled" would mean the credential check was never exercised)`,
    ).toBe('rejected');
  });

  test('🔴 the CSRF origin check is real — a foreign Origin cannot drive the session', async () => {
    // What stops a hostile page riding the user's cookie. Verified independently: the old host
    // 403s correctly.
    const ctx = await anonymousContext();
    const res = await ctx.post('/bff/login', {
      headers: { ...jsonCsrfHeaders(), Origin: 'https://evil.example.com' },
      data: { username: ZYGOS_USERS.MAKER_A, password: 'irrelevant' },
    });
    expect(res.status(), `a foreign Origin must be refused (not 200); body: ${await bodyText(res)}`).not.toBe(200);
    await ctx.dispose();
  });

  test('🔴 a mutation without the CSRF header is refused — and its 403 is NOT a maker-checker 403', async () => {
    const session = await loginAs(ZYGOS_USERS.MAKER_A);
    test.skip(!session, SKIP_REASON);

    // Deliberately omitting X-BFF-Csrf. Pinned as its own test because this exact gap silently
    // neutered the first hand-written maker-checker probe: every mutation returned
    // 403 "Anti-forgery validation failed", which a status-only assertion happily read as a
    // maker-checker refusal. The suite was green and testing nothing.
    const res = await session!.context.post(INSTRUCTIONS, {
      headers: { 'Content-Type': 'application/json', Origin: ZYGOS_WEB_URL },
      data: {
        amount: 1,
        currency: 'EUR',
        valueDate: '2026-08-01',
        direction: 'Outgoing',
        debtor: { name: 'x' },
        creditor: { name: 'y' },
      },
    });

    const body = await bodyText(res);
    expect(res.status(), `a mutation without X-BFF-Csrf must be refused; body: ${body}`).toBe(403);
    expect(body, 'the CSRF 403 must be distinguishable from a maker-checker 403').toContain('Anti-forgery');
    expect(body, 'a CSRF block must never look like a maker-checker refusal').not.toContain('Maker-checker');
  });

  test('logout revokes the session — the same cookie stops working', async () => {
    // Room to ride out a cold-start throttle rather than skip (see zygos-session.loginAs).
    test.setTimeout(180_000);

    // A FRESH session: logging out the shared cached one would break every later spec.
    const session = await loginFresh(ZYGOS_USERS.ADMIN);
    test.skip(!session, SKIP_REASON);

    // Prove it works BEFORE logout, so a post-logout 401 can only mean "logout worked" — and not
    // "this session was never valid".
    expect((await session!.context.get(INSTRUCTIONS)).status(), 'the session must work before logout').toBe(200);

    const logout = await session!.context.post('/bff/logout', { headers: csrfHeaders() });
    expect([200, 204], `logout should succeed; body: ${await bodyText(logout)}`).toContain(logout.status());

    const after = await session!.context.get(INSTRUCTIONS);
    expect(after.status(), `the session must be dead after logout; body: ${await bodyText(after)}`).toBe(401);

    await session!.dispose();
  });
});

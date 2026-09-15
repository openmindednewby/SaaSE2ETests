import { expect, test } from '@playwright/test';

// THE POINT OF THIS SUITE: it drives the SPA's OWN transport module through its documented
// test seam, so a client-shape defect (wrong prefix, missing policyVersion, a body the server
// rejects with 415) fails HERE. A hand-assembled request would test only the server and could
// never observe that class — it is the class that produced C1-C5 in NEXTGAME-1.
import { createNextGameApi, NextGameApiError, HTTP_CONFLICT } from '../../../nextgame-web/src/api/nextgameApi';
// The version the SPA stamps on every consent row. Imported, never hardcoded: a policy bump
// (DEC-3 took it to '2') must move this expectation with it, not break it silently.
import ConsentPurpose from '../../../nextgame-web/src/shared/enums/ConsentPurpose';
import { POLICY_VERSION } from '../../../nextgame-web/src/shared/privacyFacts';
import {
  NEXTGAME_API_URL,
  cookieFetch,
  createSignedInUser,
  deleteUser,
  IS_REMOTE_NEXTGAME,
  mintCookie,
  REMOTE_SEEDING_SKIP_REASON,
  seedLibrarySnapshot,
  consentRowsFor,
  type NextGameUser,
} from '../../fixtures/nextgame-session';

const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 750;
const IMPORT_START_ATTEMPTS = 5;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_SERVICE_UNAVAILABLE = 503;
// /me/player answers 200 or 503 once consent is granted (staging may carry no Steam key) — never 403.
const PLAYER_STATUSES_AFTER_CONSENT = [HTTP_OK, HTTP_SERVICE_UNAVAILABLE];
const TERMINAL_STATUSES = ['succeeded', 'failed'];
const IMPORT_STATUSES = ['queued', 'running', ...TERMINAL_STATUSES];

function apiFor(user: NextGameUser | null) {
  return createNextGameApi({
    baseUrl: NEXTGAME_API_URL,
    fetchImpl: cookieFetch(user ? user.cookie : null),
  });
}

test.describe('nextgame api contract (driven through the SPA client)', () => {
  test.skip(IS_REMOTE_NEXTGAME, REMOTE_SEEDING_SKIP_REASON);

  let user: NextGameUser;

  test.beforeEach(() => {
    user = createSignedInUser();
  });

  test.afterEach(() => {
    deleteUser(user.userId);
  });

  test('records consent for each purpose through the real client', async () => {
    const api = apiFor(user);
    // Playwright's expect has no `.resolves`; a rejection here fails the test on its own,
    // which is precisely the assertion — a consent POST that the server refuses must throw.
    await api.postConsent(ConsentPurpose.Recommendations, true);
    await api.postConsent(ConsentPurpose.AnonymisedInsights, false);

    const rows = consentRowsFor(user.userId);
    expect(rows).toContain(`0|true|${POLICY_VERSION}`);
    expect(rows).toContain(`1|false|${POLICY_VERSION}`);
  });

  test('a consent failure REJECTS so the caller can block instead of continuing', async () => {
    // A cookie signed for an id with no users row: the server answers 404 (ConsentService
    // FindByIdAsync). The assertion that matters is that the client THROWS rather than
    // resolving — AgeAndConsent blocks on this rejection.
    const ghost = { userId: '00000000-0000-4000-8000-00000000dead', steamId64: '', cookie: mintCookie('00000000-0000-4000-8000-00000000dead') };
    const api = apiFor(ghost);
    const error = await api.postConsent(ConsentPurpose.Recommendations, true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NextGameApiError);
    expect((error as NextGameApiError).status).not.toBe(200);
  });

  test('starts an import, polls it to a known status, and hides another user jobId', async () => {
    const api = apiFor(user);

    // Import single-flight is GLOBAL in v0 (see NEXTGAME-1 "Discovered" table), so a 409
    // means another user's import holds the slot. The SPA treats 409 as busy and retries;
    // this reproduces that exact loop through the same client.
    let started: { jobId: string } | undefined;
    await expect(async () => {
      started = await api.startImport().catch((e: unknown) => {
        if (e instanceof NextGameApiError && e.status === HTTP_CONFLICT) return undefined;
        throw e;
      });
      expect(started, 'POST /me/import answered 409 busy').toBeTruthy();
    })
      .toPass({ intervals: [POLL_INTERVAL_MS], timeout: POLL_INTERVAL_MS * IMPORT_START_ATTEMPTS })
      .catch(() => undefined);
    expect(started, 'POST /me/import never returned a jobId (409 busy for every attempt)').toBeTruthy();
    const jobId = started!.jobId;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/i);

    let status = await api.getImportStatus(jobId);
    // Poll toward a terminal state; still queued/running after the window is acceptable (no Steam
    // here) and is judged by the known-status assertion below, not by this wait.
    await expect(async () => {
      status = await api.getImportStatus(jobId);
      expect(TERMINAL_STATUSES).toContain(status.status);
    })
      .toPass({ intervals: [POLL_INTERVAL_MS], timeout: POLL_INTERVAL_MS * POLL_ATTEMPTS })
      .catch(() => undefined);
    expect(IMPORT_STATUSES).toContain(status.status);
    expect(status.jobId).toBe(jobId);

    // Ownership pin: a second signed-in user must not be able to read this job.
    const other = createSignedInUser();
    try {
      const error = await apiFor(other).getImportStatus(jobId).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NextGameApiError);
      expect((error as NextGameApiError).status).toBe(HTTP_NOT_FOUND);
    } finally {
      deleteUser(other.userId);
    }
  });

  test('returns the library in the wire shape the SPA reads', async () => {
    seedLibrarySnapshot(user.userId);
    const library = await apiFor(user).getLibrary();

    expect(Array.isArray(library.owned)).toBe(true);
    expect(library.owned.length).toBeGreaterThan(0);
    const [first] = library.owned;
    expect(typeof first.appId).toBe('number');
    expect(typeof first.name).toBe('string');
    expect(typeof first.minutesForever).toBe('number');
    expect(typeof first.minutesTwoWeeks).toBe('number');
    expect(typeof library.totalOwned).toBe('number');
    expect(library.totalOwned).toBe(library.owned.length);
    expect(typeof library.totalPlayed).toBe('number');
    expect(Number.isNaN(Date.parse(String(library.takenAt)))).toBe(false);
  });

  test('GET /me/session returns the probe shape for a signed-in user', async () => {
    const session = await apiFor(user).getSession();
    expect(session).not.toBeNull();
    expect(session).toMatchObject({
      steamIdTail: expect.any(String) as unknown,
      birthYearSet: expect.any(Boolean) as unknown,
      recommendationsConsent: expect.any(Boolean) as unknown,
    });
  });

  // NEGATIVE CONTROL for the next test: flip to true, run, confirm the test goes red as an
  // EXPECTED failure (test.fail() below), then flip back to false and restore. The consent POST
  // is skipped but the REAL assertions below are kept unchanged — nothing swaps in a different
  // assertion — so a lingering 403 (or any other bug that makes the control not fail) reddens the
  // run via an unexpected pass. Not yet observed in this dispatch — see task-E1-report.md.
  const SKIP_CONSENT_NEGATIVE_CONTROL = false;

  test('GET /me/player is 403 before consent, and 403 is gone once Recommendations is granted', async () => {
    test.fail(SKIP_CONSENT_NEGATIVE_CONTROL, 'negative control: consent POST skipped, 403 must persist');
    // The SPA client's getPlayer() collapses BOTH 403 and 404 to null (nextgameApi.ts HTTP_FORBIDDEN,
    // HTTP_NOT_FOUND allow-list), so it cannot itself prove "the 403 specifically is gone" — that
    // needs the raw wire status, not the client's narrowed shape.
    const playerUrl = `${NEXTGAME_API_URL}/api/v1/me/player`;
    const fetchImpl = cookieFetch(user.cookie);

    const before = await fetchImpl(playerUrl);
    expect(before.status, 'expected 403 before any consent is granted').toBe(HTTP_FORBIDDEN);

    if (!SKIP_CONSENT_NEGATIVE_CONTROL) {
      await apiFor(user).postConsent(ConsentPurpose.Recommendations, true);
    }

    const after = await fetchImpl(playerUrl);
    expect(after.status, '403 must be gone once Recommendations consent is granted').not.toBe(HTTP_FORBIDDEN);
    // 503 (missing Steam key, or Steam itself unavailable) is an accepted outcome alongside 200.
    expect(PLAYER_STATUSES_AFTER_CONSENT, `unexpected /me/player status ${String(after.status)} after consent`).toContain(
      after.status,
    );
  });

  test('POST /auth/logout answers 204 and clears the session cookie', async () => {
    // Raw fetch, not the SPA client: logout() throws away the response after checking .ok, and the
    // thing under test here — the Set-Cookie that actually clears the browser's cookie — lives only
    // on that response. The session cookie is a stateless signed token (SessionCookie.cs): the SERVER
    // never revokes it, so resending the SAME minted cookie after logout would still authenticate —
    // that is NOT a regression, it is how this design works, and asserting a plain "401 next" would
    // silently pass or fail for the wrong reason. Proving logout means proving the cookie gets cleared.
    const response = await globalThis.fetch(`${NEXTGAME_API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: user.cookie, 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(HTTP_NO_CONTENT);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie, 'logout response did not clear the session cookie').toMatch(/__Host-nextgame-session=;/);
  });
});

/** Signed-out pins: no seeded row, no minted cookie, so they run against a deployed host too. */
test.describe('nextgame api contract, signed out (driven through the SPA client)', () => {
  test('GET /me/session resolves null (401) with no session cookie', async () => {
    await expect(apiFor(null).getSession()).resolves.toBeNull();
  });

  test('unauthenticated consent is refused', async () => {
    const error = await apiFor(null).postConsent(ConsentPurpose.Recommendations, true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NextGameApiError);
    expect((error as NextGameApiError).status).toBe(HTTP_UNAUTHORIZED);
  });

  test('library is 401 unauthenticated and the bare (unprefixed) route does not exist', async () => {
    const error = await apiFor(null).getLibrary().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NextGameApiError);
    expect((error as NextGameApiError).status).toBe(HTTP_UNAUTHORIZED);

    // Route-prefix pin. Deliberately NOT through the client: the client can only ever emit
    // /api/v1, and the thing being pinned is that the UNPREFIXED path is absent. No cookie is
    // needed: an existing auth-guarded route would answer 401, an absent one 404. Against a
    // deployed host this path is answered by nginx, not the API (only /api/ is proxied).
    const bare = await globalThis.fetch(`${NEXTGAME_API_URL}/me/library`);
    expect(bare.status).toBe(HTTP_NOT_FOUND);
  });
});

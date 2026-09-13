import { expect, test } from '@playwright/test';

// THE POINT OF THIS SUITE: it drives the SPA's OWN transport module through its documented
// test seam, so a client-shape defect (wrong prefix, missing policyVersion, a body the server
// rejects with 415) fails HERE. A hand-assembled request would test only the server and could
// never observe that class — it is the class that produced C1-C5 in NEXTGAME-1.
import { createNextGameApi, NextGameApiError, HTTP_CONFLICT } from '../../../nextgame-web/src/api/nextgameApi';
// The version the SPA stamps on every consent row. Imported, never hardcoded: a policy bump
// (DEC-3 took it to '2') must move this expectation with it, not break it silently.
import { POLICY_VERSION } from '../../../nextgame-web/src/shared/privacyFacts';
import {
  NEXTGAME_API_URL,
  cookieFetch,
  createSignedInUser,
  deleteUser,
  mintCookie,
  seedLibrarySnapshot,
  consentRowsFor,
  type NextGameUser,
} from '../../fixtures/nextgame-session';

const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 750;
const IMPORT_START_ATTEMPTS = 5;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const IMPORT_STATUSES = ['queued', 'running', 'succeeded', 'failed'];

function apiFor(user: NextGameUser | null) {
  return createNextGameApi({
    baseUrl: NEXTGAME_API_URL,
    fetchImpl: cookieFetch(user ? user.cookie : null),
  });
}

test.describe('nextgame api contract (driven through the SPA client)', () => {
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
    await api.postConsent('recommendations', true);
    await api.postConsent('anonymisedInsights', false);

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
    const error = await api.postConsent('recommendations', true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NextGameApiError);
    expect((error as NextGameApiError).status).not.toBe(200);
  });

  test('unauthenticated consent is refused', async () => {
    const error = await apiFor(null).postConsent('recommendations', true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NextGameApiError);
    expect((error as NextGameApiError).status).toBe(HTTP_UNAUTHORIZED);
  });

  test('starts an import, polls it to a known status, and hides another user jobId', async () => {
    const api = apiFor(user);

    // Import single-flight is GLOBAL in v0 (see NEXTGAME-1 "Discovered" table), so a 409
    // means another user's import holds the slot. The SPA treats 409 as busy and retries;
    // this reproduces that exact loop through the same client.
    let started: { jobId: string } | undefined;
    for (let attempt = 0; attempt < IMPORT_START_ATTEMPTS && !started; attempt += 1) {
      started = await api.startImport().catch((e: unknown) => {
        if (e instanceof NextGameApiError && e.status === HTTP_CONFLICT) return undefined;
        throw e;
      });
      if (!started) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    expect(started, 'POST /me/import never returned a jobId (409 busy for every attempt)').toBeTruthy();
    const jobId = started!.jobId;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/i);

    let status = await api.getImportStatus(jobId);
    for (let attempt = 0; attempt < POLL_ATTEMPTS && (status.status === 'queued' || status.status === 'running'); attempt += 1) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      status = await api.getImportStatus(jobId);
    }
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

  test('library is 401 unauthenticated and the bare (unprefixed) route does not exist', async () => {
    const error = await apiFor(null).getLibrary().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NextGameApiError);
    expect((error as NextGameApiError).status).toBe(HTTP_UNAUTHORIZED);

    // Route-prefix pin. Deliberately NOT through the client: the client can only ever emit
    // /api/v1, and the thing being pinned is that the UNPREFIXED path is absent.
    const bare = await globalThis.fetch(`${NEXTGAME_API_URL}/me/library`, { headers: { Cookie: user.cookie } });
    expect(bare.status).toBe(HTTP_NOT_FOUND);
  });
});

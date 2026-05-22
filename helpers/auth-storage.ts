/**
 * Browser-side auth-storage assertion helpers.
 *
 * BaseClient persists the Redux `auth` slice to `sessionStorage['persist:auth']`
 * via a store subscriber. On logout, `scheduleLogoutCleanup` clears storage AND
 * re-dispatches the auth-clear action on a staggered timer schedule
 * (0/50/200/500/1000ms) — so the subscriber re-writes `persist:auth` several
 * times after logout begins. A single non-polled snapshot races that schedule;
 * specs must poll these helpers until storage reaches its terminal state.
 */
import type { Page } from '@playwright/test';

/**
 * Returns true when `sessionStorage['persist:auth']` is in a logged-out
 * terminal state: removed, unparseable, or present with both `accessToken`
 * and `refreshToken` cleared (null / '' / 'null').
 */
export async function readPersistAuthTokensCleared(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('persist:auth');
    if (!raw) return true;
    let parsed: { accessToken?: unknown; refreshToken?: unknown } = {};
    try {
      parsed = JSON.parse(raw) ?? {};
    } catch {
      return true;
    }
    const isFalsy = (v: unknown): boolean => !v || v === 'null' || v === '';
    return isFalsy(parsed.accessToken) && isFalsy(parsed.refreshToken);
  });
}

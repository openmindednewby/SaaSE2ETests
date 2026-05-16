/**
 * KI-5 helper: inject a realm-specific token into a Playwright page so the
 * SPA loads as if logged-in against that realm, bypassing the realm-pinned
 * UI login flow.
 *
 * Why this exists: the SPA at staging.app.dloizides.com is configured for
 * the `onlinemenu` realm — UI login through LoginPage always mints an
 * onlinemenu-realm token. questioner-api enforces a cross-realm wall
 * (ProductRealms=["questioner"]) so onlinemenu tokens are rejected,
 * breaking every browser-driven questioner test.
 *
 * The fix is realm-agnostic to the SPA: it stores `persist:auth` (Redux
 * persist format) in sessionStorage/localStorage and treats any bearer
 * token there as authenticated. By minting via the identity-api
 * `/auth/login` endpoint with the desired X-Realm header and injecting the
 * resulting token directly into the page's storage state, the SPA renders
 * as if the user logged in to that realm — without needing the SPA itself
 * to be re-pointed.
 *
 * Usage in a questioner spec's beforeAll:
 *
 *     const page = await context.newPage();
 *     await injectRealmAuth(page, {
 *       baseURL: process.env.BASE_URL!,
 *       username: adminUser.username,
 *       password: adminUser.password,
 *       realm: 'questioner',
 *     });
 *     // Now navigations from `page` carry a questioner-realm bearer.
 */
import type { Page } from '@playwright/test';

import { LoginPage } from '../pages/LoginPage.js';
import { AuthHelper } from './auth-helper.js';

interface InjectRealmAuthOptions {
  baseURL: string;
  username: string;
  password: string;
  realm: string;
}

interface AuthState {
  accessToken: string;
  refreshToken: string | null;
  isLoggedIn: true;
  user: unknown;
  userInfo: unknown;
  loading: false;
  refreshingUserInfo: false;
}

/**
 * Mints a token from the named realm and seeds it into the page's storage
 * BEFORE the SPA initializes. Subsequent `page.goto(...)` calls will see
 * the SPA in its authenticated state.
 *
 * No-op when `realm` matches the SPA's default realm — in that case the
 * normal UI login path is fine and this helper would just double the work.
 */
export async function injectRealmAuth(page: Page, opts: InjectRealmAuthOptions): Promise<void> {
  const auth = new AuthHelper(undefined, opts.realm);
  const tokens = await auth.loginViaAPI(opts.username, opts.password);
  if (!tokens.accessToken) {
    throw new Error(`injectRealmAuth: login to realm '${opts.realm}' returned no accessToken`);
  }

  const authState: AuthState = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    isLoggedIn: true,
    user: tokens.userInfo,
    userInfo: tokens.userInfo,
    loading: false,
    refreshingUserInfo: false,
  };
  const persistAuthJson = JSON.stringify(authState);

  // The SPA's bootstrap reads persist:auth from sessionStorage; the
  // restoreAuthToSessionStorage init script in auth.fixture.ts copies it
  // from localStorage on first navigation. Seed BOTH to cover both code
  // paths regardless of whether the spec opts into that fixture.
  await page.addInitScript((data: { authJson: string; origin: string }) => {
    try {
      // sessionStorage isn't writable from addInitScript before the document
      // is loaded; copy on first script eval after the doc bootstraps. The
      // app's persist:auth listener picks it up on hydrate.
      if (window.location.origin === data.origin) {
        sessionStorage.setItem('persist:auth', data.authJson);
        localStorage.setItem('persist:auth', data.authJson);
      }
    } catch {
      // If the storage write fails (e.g. cross-origin), the subsequent
      // page.evaluate fallback below catches it.
    }
  }, { authJson: persistAuthJson, origin: new URL(opts.baseURL).origin });
}

interface LoginTenantAdminOptions {
  username: string;
  password: string;
  /**
   * The realm to mint the actual API-call token from. Should match the
   * product the test exercises (e.g. 'questioner' for questioner specs).
   * On local target this is ignored — local KC has a combined realm.
   */
  productRealm: 'questioner' | 'onlinemenu';
}

/**
 * KI-5 wrapper: replaces the boilerplate `LoginPage.loginAndWait` +
 * persist-storage block that every browser spec used to repeat. On
 * staging/prod (where the SPA is realm-pinned), additionally overlays a
 * `productRealm`-scoped token via {@link injectRealmAuth} so cross-product
 * API calls (questioner-api from the onlinemenu-pinned SPA) succeed.
 *
 * Local target: drops to the legacy UI-login path unchanged — local KC has
 * a single combined realm so no token swap is needed.
 *
 * Call from `test.beforeAll` (or wherever you currently do the LoginPage
 * dance):
 *
 *     await loginAsTenantAdminBrowser(page, adminUser, { productRealm: 'questioner' });
 */
export async function loginAsTenantAdminBrowser(
  page: Page,
  user: { username: string; password: string },
  opts: { productRealm: 'questioner' | 'onlinemenu' },
): Promise<void> {
  const target = process.env.E2E_TARGET ?? 'local';

  if (target === 'staging' || target === 'prod') {
    // staging/prod: skip the UI login entirely. The SPA is realm-pinned to
    // onlinemenu — its UI login flow would give us the wrong-realm token.
    // injectRealmAuth seeds the page's storage with a `productRealm`-scoped
    // token; the next `page.goto(...)` (test's own first nav) reads it as
    // the authenticated state. No UI bootstrap needed.
    await injectRealmAuth(page, {
      baseURL: process.env.BASE_URL!,
      username: user.username,
      password: user.password,
      realm: opts.productRealm,
    });
    return;
  }

  // Local target: legacy UI login dance — local KC has a single combined
  // realm so the SPA-minted token works for every product API.
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.loginAndWait(user.username, user.password);

  // Save auth state to localStorage so it persists across page navigations.
  await page.evaluate(() => {
    const persistAuth = sessionStorage.getItem('persist:auth');
    if (persistAuth) {
      localStorage.setItem('persist:auth', persistAuth);
    }
  });
}


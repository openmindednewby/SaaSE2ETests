// Zygos in-app Knowledge Base / Guide @ui (#179 Phase 1) — the searchable Help surface,
// driven in a real browser against the DEPLOYED console.
//
// The Guide is 100% client-side (a Fuse.js index over the finreg articles — no backend, no
// API key, no LLM), so these tests need only a logged-in session and a browser: type a query,
// get a ranked result, open the article, and confirm the per-page ⓘ deep-links into it.
import { expect, test } from '@playwright/test';

import { ZYGOS_USERS, zygosTag } from './zygos-helpers.js';
import { parkedCookies } from './zygos-session.js';

import type { Page } from '@playwright/test';

/**
 * testIDs mirrored from `zygos/finreg-web/src/shared/testIds.ts`. Mirrored here (not added to
 * the global barrel) because they are Zygos-only, exactly like `zygos-console.ui.spec.ts`.
 * The login ids are DERIVED from zygos's `testIdPrefix="zygos"` on the shared `<LoginForm>`.
 */
const T = {
  loginPage: 'zygos-login-page',
  shell: 'zygos-app-shell',

  guideNavLeaf: 'nav-guide',
  guideScreen: 'zygos-guide-screen',
  guideSearch: 'zygos-guide-search',
  guideResults: 'zygos-guide-results',
  guideResultsEmpty: 'zygos-guide-results-empty',
  guideBrowse: 'zygos-guide-browse',
  guideArticle: 'zygos-guide-article',
  guideArticleBack: 'zygos-guide-article-back',

  instructionsScreen: 'zygos-instructions-screen',
  pageHelpTrigger: 'zygos-page-help-trigger',
  pageHelpFullGuide: 'zygos-page-help-full-guide',
} as const;

const id = (testId: string): string => `[data-testid="${testId}"]`;
/** A Guide result / browse row, e.g. `zygos-guide-row-approve-batch` (see `guideRowTestID`). */
const row = (articleId: string): string => `zygos-guide-row-${articleId}`;

/**
 * Enter the console using an already-minted session cookie (the login budget is 5/60s per IP;
 * see `zygos-session.parkedCookies`). Nothing is mocked — the cookie is real and server-issued.
 */
async function enterConsoleAs(page: Page, username: string): Promise<void> {
  const cookies = await parkedCookies(username);
  expect(cookies.length, `no session could be minted for ${username}`).toBeGreaterThan(0);

  await page.context().clearCookies();
  await page.context().addCookies(cookies);

  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator(id(T.shell))).toBeVisible({ timeout: 20_000 });
}

test.describe('Zygos in-app Guide @zygos-ui @ui', () => {
  test('opens from the sidebar, searches, and reads an article', async ({ page }) => {
    await enterConsoleAs(page, ZYGOS_USERS.MAKER_A);

    // Reachable from the persistent rail leaf (the #179 nav wiring), not only by deep-link.
    await page.locator(id(T.guideNavLeaf)).click();
    await expect(page.locator(id(T.guideScreen))).toBeVisible({ timeout: 15_000 });
    // An empty box shows the category browse, not an empty result set.
    await expect(page.locator(id(T.guideBrowse))).toBeVisible();

    // Type a task query; the ranked results appear live and the batch-approval article leads.
    await page.locator(id(T.guideSearch)).fill('approve batch');
    await expect(page.locator(id(T.guideResults))).toBeVisible({ timeout: 10_000 });
    const approveBatchRow = page.locator(id(row('approve-batch')));
    await expect(approveBatchRow).toBeVisible();

    // Open the article and confirm the reader rendered its how-to, then step back out.
    await approveBatchRow.click();
    await expect(page.locator(id(T.guideArticle))).toBeVisible();
    await expect(page.getByText('Approve or reject a batch')).toBeVisible();

    // Back preserves the query, so it returns to the RESULTS (not the browse view) — the
    // search context is kept. Clearing the box is what returns to browse.
    await page.locator(id(T.guideArticleBack)).click();
    await expect(page.locator(id(T.guideResults))).toBeVisible();
    await expect(approveBatchRow).toBeVisible();

    await page.locator(id(T.guideSearch)).fill('');
    await expect(page.locator(id(T.guideBrowse))).toBeVisible();
  });

  test('shows an empty state for a query that matches nothing', async ({ page }) => {
    await enterConsoleAs(page, ZYGOS_USERS.MAKER_A);
    await page.goto('/help', { waitUntil: 'commit' });
    await expect(page.locator(id(T.guideScreen))).toBeVisible({ timeout: 15_000 });

    await page.locator(id(T.guideSearch)).fill(zygosTag('nonexistent-query'));
    await expect(page.locator(id(T.guideResultsEmpty))).toBeVisible({ timeout: 10_000 });
  });

  test("a page's ⓘ help deep-links into the full Guide article", async ({ page }) => {
    await enterConsoleAs(page, ZYGOS_USERS.MAKER_A);
    await page.goto('/instructions', { waitUntil: 'commit' });
    await expect(page.locator(id(T.instructionsScreen))).toBeVisible({ timeout: 15_000 });

    // Open the per-page ⓘ popover, then follow "Open full guide →".
    await page.locator(id(T.pageHelpTrigger)).click();
    await page.locator(id(T.pageHelpFullGuide)).click();

    // Lands on the Guide, already showing the instructions article (not the browse view).
    await expect(page.locator(id(T.guideArticle))).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('The payment instructions list')).toBeVisible();
  });
});

import AxeBuilder from '@axe-core/playwright';
import { expectTextFits } from '@dloizides/game-e2e';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { holdPosts } from './helpers/live-api';
import { answerRows, fillReporter, holdSearch, isSearchRequest, LISTBOX_ID, livePattern, liveSearchSlugs, liveTitleAndDescription, openOneRowList, patternField, patternMenu, patternRow, patternRowId, patternRows, pickFirstRowByKeys, readSearchWaits, recordSearchWaits, REPORT_URL, routeSearch } from './helpers/report-search';
import { DESKTOP, NO_MATCH_QUERY, PHONE, readLayoutProblems } from './helpers/screens';

const REPORTER = 'e2e-report@example.com';
const STATEMENT = 'E2E probe, no report is stored';
const RECEIVED = 'Report received';
const NO_MATCH = 'No patterns match';
const NOT_FOUND = 'That pattern does not exist or has been removed.';
const SEARCH_FAILED = 'Search is not working right now. You can still paste the link.';
const SUBMIT = 'jinx-report-submit';
const STATUS = 'jinx-report-status';
const VISIBLE_TEXT = 'body *:not(.skip):not(.dlz-consent__sr):not([id^="a11y-hint-"])';
const DETAIL_TWO_LINES_PX = 24;
const ROW_A = { slug: 'e2e-alpha-band', title: 'E2E Alpha Band', stitch: 'Loom', piece: 'Bracelet', width: 9, height: 60, beadTotal: 540 };
const ROW_A_DETAIL = 'Loom, Bracelet, 9 x 60, 540 beads';
const ROW_B = { ...ROW_A, slug: 'e2e-beta-band', title: 'E2E Beta Band' };
const ROW_C = { ...ROW_A, slug: 'e2e-gamma-band', title: 'E2E Gamma Band' };

function reportOn(patternId: string): object {
  return { patternId, kind: 'Copyright', reporterEmail: REPORTER, statement: STATEMENT };
}

test.use({ serviceWorkers: 'block' });

for (const viewport of [{ label: '360x640', use: PHONE }, { label: '1280x800', use: DESKTOP }]) {
  test.describe(`search field at ${viewport.label}`, () => {
    test.use(viewport.use);

    const press = (row: Locator): Promise<void> => (viewport.use === PHONE ? row.tap() : row.click());

    test('AC-RS-1 two typed characters, lists at most 8 live matches within 1 s', async ({ page, request }) => {
      const { title } = await livePattern(request);
      const query = title.slice(0, 2);
      const expected = (await liveSearchSlugs(request, query)).slice(0, 8);
      await page.goto(REPORT_URL);

      await patternField(page).fill(query);

      await expect(patternRow(page, expected[0])).toBeVisible({ timeout: 1_000 });
      expect(await patternRows(page).evaluateAll((rows) => rows.map((row) => row.id))).toEqual(expected.map(patternRowId));
      const matched = await Promise.all(expected.map((slug) => liveTitleAndDescription(request, slug)));
      expect(matched.filter((text) => !text.toLowerCase().includes(query.toLowerCase()))).toEqual([]);
    });

    test('AC-RS-1 one typed character, sends no search', async ({ page }) => {
      await page.goto(REPORT_URL);
      const search = page.waitForRequest((sent) => isSearchRequest(sent.url()), { timeout: 600 });

      await patternField(page).fill('g');

      await expect(search).rejects.toThrow();
    });

    const picks = [
      { how: 'pressing a row', pick: (page: Page, slug: string) => press(patternRow(page, slug)) },
      { how: 'arrows and Enter on a row', pick: pickFirstRowByKeys },
    ];
    for (const { how, pick } of picks) {
      test(`AC-RS-2 ${how}, shows its title and posts its id once`, async ({ page, request }) => {
        const { slug, title, externalId } = await livePattern(request);
        const posts = await holdPosts(page, '/reports', 202, {});
        await page.goto(REPORT_URL);
        await patternField(page).fill(title.slice(0, -1));
        await pick(page, slug);
        await expect(patternField(page)).toHaveValue(title);
        await fillReporter(page, REPORTER, STATEMENT);

        await page.getByTestId(SUBMIT).click();

        await expect(page.getByTestId(STATUS)).toContainText(RECEIVED);
        expect(posts).toEqual([reportOn(externalId)]);
      });
    }

    for (const pasted of ['link', 'slug']) {
      test(`AC-RS-3 a pasted ${pasted} with no row picked, posts that pattern's id`, async ({ page, request, baseURL }) => {
        const { slug, externalId } = await livePattern(request);
        const posts = await holdPosts(page, '/reports', 202, {});
        await page.goto(REPORT_URL);
        await patternField(page).fill(pasted === 'link' ? `${baseURL}/patterns/${slug}` : slug);
        await fillReporter(page, REPORTER, STATEMENT);

        await page.getByTestId(SUBMIT).click();

        await expect(page.getByTestId(STATUS)).toContainText(RECEIVED);
        expect(posts).toEqual([reportOn(externalId)]);
      });
    }

    test('AC-RS-4 no match, says so; Send shows not found and posts nothing', async ({ page }) => {
      const posts = await holdPosts(page, '/reports', 202, {});
      await page.goto(REPORT_URL);
      await patternField(page).fill(NO_MATCH_QUERY);
      await expect(patternMenu(page)).toContainText(NO_MATCH);
      await fillReporter(page, REPORTER, STATEMENT);

      await page.getByTestId(SUBMIT).click();

      await expect(page.getByTestId(STATUS)).toContainText(NOT_FOUND);
      expect(posts).toEqual([]);
    });

    test('AC-RS-5 quick typing, sends one search at least 250 ms after the last key', async ({ page }) => {
      const queries: string[] = [];
      await recordSearchWaits(page);
      await routeSearch(page, (query, route) => { queries.push(query); return answerRows(route, [ROW_A]); });
      await page.goto(REPORT_URL);

      await patternField(page).pressSequentially('e2e', { delay: 30 });

      await expect(patternRow(page, ROW_A.slug)).toBeVisible();
      expect(queries).toEqual(['e2e']);
      expect((await readSearchWaits(page)).filter((waited) => waited < 250)).toEqual([]);
    });

    test('AC-RS-5 older response arriving after a newer one, keeps the newer rows', async ({ page }) => {
      const held = await holdSearch(page, 'e2e', [ROW_A], [ROW_B]);
      await page.goto(REPORT_URL);
      await patternField(page).fill('e2e');
      await held.reached;
      await patternField(page).fill('e2e-b');
      await expect(patternRow(page, ROW_B.slug)).toBeVisible();

      await held.release();

      await expect(patternRow(page, ROW_B.slug)).toBeVisible();
      await expect(patternRow(page, ROW_A.slug)).toHaveCount(0);
    });

    test('AC-RS-6 search answers 500, says so and a pasted slug still sends', async ({ page, request }) => {
      const { slug, externalId } = await livePattern(request);
      const posts = await holdPosts(page, '/reports', 202, {});
      await routeSearch(page, (_query, route) => route.fulfill({ status: 500, body: '{}' }));
      await page.goto(REPORT_URL);
      await patternField(page).fill(slug);
      await expect(patternMenu(page)).toContainText(SEARCH_FAILED);
      await fillReporter(page, REPORTER, STATEMENT);

      await page.getByTestId(SUBMIT).click();

      await expect(page.getByTestId(STATUS)).toContainText(RECEIVED);
      expect(posts).toEqual([reportOn(externalId)]);
    });

    test('AC-RS-7 editing the text after a pick, clears the pick so nothing posts', async ({ page, request }) => {
      const { slug, title } = await livePattern(request);
      const posts = await holdPosts(page, '/reports', 202, {});
      await page.goto(REPORT_URL);
      await patternField(page).fill(title.slice(0, -1));
      await press(patternRow(page, slug));
      await expect(patternField(page)).toHaveValue(title);
      await patternField(page).pressSequentially('x');
      await fillReporter(page, REPORTER, STATEMENT);

      await page.getByTestId(SUBMIT).click();

      await expect(page.getByTestId(STATUS)).toContainText(NOT_FOUND);
      expect(posts).toEqual([]);
    });

    test('AC-RS-8 report link with an id, hides the field and focuses Your email', async ({ page, request }) => {
      const { slug } = await livePattern(request);

      await page.goto(`${REPORT_URL}?id=${slug}`);

      await expect(page.getByTestId('jinx-report-email')).toBeFocused();
      await expect(patternField(page)).toBeHidden();
    });

    test.describe('with three rows open', () => {
      test.beforeEach(async ({ page }) => {
        await routeSearch(page, (_query, route) => answerRows(route, [ROW_A, ROW_B, ROW_C]));
        await page.goto(REPORT_URL);
        await patternField(page).fill('e2e');
        await expect(patternRow(page, ROW_C.slug)).toBeVisible();
      });

      test('AC-KB-1 Down, Down, Up, highlights the first row', async ({ page }) => {
        await patternField(page).press('ArrowDown');
        await patternField(page).press('ArrowDown');
        await expect(patternField(page)).toHaveAttribute('aria-activedescendant', patternRowId(ROW_B.slug));

        await patternField(page).press('ArrowUp');

        await expect(patternField(page)).toHaveAttribute('aria-activedescendant', patternRowId(ROW_A.slug));
      });

      test('AC-KB-1 Enter on a highlighted row, picks it and closes the list', async ({ page }) => {
        await patternField(page).press('ArrowDown');
        await patternField(page).press('ArrowDown');

        await patternField(page).press('Enter');

        await expect(patternField(page)).toHaveValue(ROW_B.title);
        await expect(patternMenu(page)).toBeHidden();
      });

      test('AC-KB-1 Esc, closes the list and keeps the text', async ({ page }) => {
        await patternField(page).press('Escape');

        await expect(patternMenu(page)).toBeHidden();
        await expect(patternField(page)).toHaveValue('e2e');
      });

      test('AC-KB-1 Enter with no row highlighted, sends the form once', async ({ page, request }) => {
        const { slug, externalId } = await livePattern(request);
        const posts = await holdPosts(page, '/reports', 202, {});
        await fillReporter(page, REPORTER, STATEMENT);
        await expect(patternMenu(page)).toBeHidden();
        await patternField(page).fill(slug);
        await expect(patternRow(page, ROW_A.slug)).toBeVisible();

        await patternField(page).press('Enter');

        await expect(page.getByTestId(STATUS)).toContainText(RECEIVED);
        expect(posts).toEqual([reportOn(externalId)]);
      });

      test('AC-KB-2 list open with a row highlighted, is an ARIA combobox and axe finds 0 violations', async ({ page }) => {
        await patternField(page).press('ArrowDown');

        const { violations } = await new AxeBuilder({ page }).analyze();

        await expect(patternField(page)).toHaveAttribute('role', 'combobox');
        await expect(patternField(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(patternField(page)).toHaveAttribute('aria-controls', LISTBOX_ID);
        await expect(page.locator(`#${LISTBOX_ID}[role="listbox"] [role="option"]#${patternRowId(ROW_A.slug)}`)).toHaveAttribute('aria-selected', 'true');
        expect(violations.map((found) => `${found.id}: ${found.nodes.map((node) => `${node.target.join(' ')} ${node.any[0]?.message ?? ''}`).join(' | ')}`)).toEqual([]);
      });
    });

    test('AC-UI-1 list open on live rows, rows at least 44 px, text fits, no horizontal scroll', async ({ page, request }) => {
      const { title } = await livePattern(request);
      await page.goto(REPORT_URL);
      await patternField(page).fill(title.slice(0, 2));
      await expect(patternRows(page).first()).toBeVisible();

      const heights = await patternRows(page).evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));

      expect(heights.filter((height) => height < 44)).toEqual([]);
      expect(await readLayoutProblems(page)).toEqual([]);
      await expectTextFits(page, VISIBLE_TEXT);
    });
  });
}

test.describe('search field at 360x640 only', () => {
  test.use(PHONE);

  test('AC-UI-2 pressing Send on an unknown pattern, Send and the result are both in view', async ({ page }) => {
    await page.goto(REPORT_URL);
    await patternField(page).fill(NO_MATCH_QUERY);
    await fillReporter(page, REPORTER, STATEMENT);

    await page.getByTestId(SUBMIT).click();

    await expect(page.getByTestId(STATUS)).toContainText(NOT_FOUND);
    await expect(page.getByTestId(STATUS)).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId(SUBMIT)).toBeInViewport({ ratio: 1 });
  });

  test('AC-UI-3 open list, floats with the detail on one line under the title', async ({ page }) => {
    const row = await openOneRowList(page, ROW_A);

    const position = await patternMenu(page).evaluate((menu) => getComputedStyle(menu).position);

    expect(position).toBe('fixed');
    const title = await row.getByText(ROW_A.title).boundingBox();
    const detail = await row.getByText(ROW_A_DETAIL).boundingBox();
    expect(detail?.y).toBeGreaterThanOrEqual((title?.y ?? 0) + (title?.height ?? 0) - 1);
    expect(detail?.height).toBeLessThan(DETAIL_TWO_LINES_PX);
  });
});

test.describe('search field at 1280x800 only', () => {
  test.use(DESKTOP);

  test('AC-UI-4 open list, floats with the detail beside the title', async ({ page }) => {
    const row = await openOneRowList(page, ROW_A);

    const position = await patternMenu(page).evaluate((menu) => getComputedStyle(menu).position);

    expect(position).toBe('fixed');
    const title = await row.getByText(ROW_A.title).boundingBox();
    const detail = await row.getByText(ROW_A_DETAIL).boundingBox();
    expect(detail?.x).toBeGreaterThanOrEqual((title?.x ?? 0) + (title?.width ?? 0));
    expect(detail?.y).toBeLessThan((title?.y ?? 0) + (title?.height ?? 0));
  });
});

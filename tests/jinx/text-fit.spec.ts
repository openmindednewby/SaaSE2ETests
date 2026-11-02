import { expect, test } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import { APP_SCREENS, DESKTOP, PHONE, readLayoutProblems, recordWrites, SITE_SCREENS } from './helpers/screens';

const VISIBLE_TEXT = 'body *:not(.skip):not(.dlz-consent__sr):not([id^="a11y-hint-"])';
const VIEWPORTS = [
  { label: '360x640', use: PHONE },
  { label: '1280x800', use: DESKTOP },
];

for (const viewport of VIEWPORTS) {
  test.describe(viewport.label, () => {
    test.use(viewport.use);

    for (const screen of [...SITE_SCREENS, ...APP_SCREENS]) {
      test(`AC-51 ${screen.name} at ${viewport.label}, Walk, expectTextFits passes; no horizontal scroll; hit boxes >= 44`, async ({ page }) => {
        const writes = recordWrites(page);
        await screen.open(page);

        const problems = await readLayoutProblems(page);

        expect.soft(problems).toEqual([]);
        await expectTextFits(page, VISIBLE_TEXT);
        expect(writes).toEqual([]);
      });
    }
  });
}

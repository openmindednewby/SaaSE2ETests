import { expect, test } from '@playwright/test';

import { enterConsoleAs, masterAccount, merchantAccount, resolveDemoAccounts, sessionFor } from '../zygos-master.js';

import type { Page } from '@playwright/test';
import type { ZygosSession } from '../zygos-session.js';

export interface TourCase {
  readonly id: string;
  readonly persona: 'master' | 'merchant';
  readonly route: string;
  readonly steps: number;
}

interface TourEventRecord {
  readonly name: string;
  readonly tourId: string;
  readonly mode: string;
}

const STEP_BUDGET_MS = 9_000;
const BASE_BUDGET_MS = 60_000;
const POLL_MS = 500;
const UNAVAILABLE = "This step isn't available here";

async function seedAutoTour(page: Page, tourId: string): Promise<void> {
  await page.addInitScript((id: string) => {
    const host = window as unknown as { __tourEvents: TourEventRecord[]; umami: unknown };
    host.__tourEvents = [];
    host.umami = { track: (name: string, data: Record<string, string>) => host.__tourEvents.push({ name, tourId: data.tourId, mode: data.mode }) };
    if (sessionStorage.getItem('__tour-e2e-seeded') === null) {
      sessionStorage.setItem('__tour-e2e-seeded', '1');
      sessionStorage.setItem('__tour-state', JSON.stringify({ tourId: id, step: 0, mode: 'auto' }));
    }
  }, tourId);
}

async function readEvents(page: Page): Promise<TourEventRecord[]> {
  return page.evaluate(() => (window as unknown as { __tourEvents?: TourEventRecord[] }).__tourEvents ?? []);
}

async function waitForFinish(page: Page, tour: TourCase): Promise<void> {
  const deadline = Date.now() + BASE_BUDGET_MS + tour.steps * STEP_BUDGET_MS;
  while (Date.now() < deadline) {
    const events = await readEvents(page);
    if (events.some((event) => event.name === 'tour_finish' && event.tourId === tour.id)) return;
    expect(events.filter((event) => event.name === 'tour_quit'), `${tour.id} quit`).toEqual([]);
    const caption = page.locator('[role="dialog"][aria-live="polite"]');
    const stuck = await page.getByText(UNAVAILABLE).isVisible().catch(() => false);
    if (stuck) {
      const meta = await caption.innerText().catch(() => '');
      throw new Error(`${tour.id}: step unavailable: ${meta.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    await page.waitForTimeout(POLL_MS);
  }
  throw new Error(`${tour.id}: no tour_finish within budget`);
}

export function runTourCategory(tours: readonly TourCase[]): void {
  const sessions = new Map<string, ZygosSession | null>();

  test.beforeAll(async () => {
    const accounts = await resolveDemoAccounts();
    sessions.set('master', await sessionFor(masterAccount(accounts)));
    sessions.set('merchant', await sessionFor(merchantAccount(accounts)));
  });

  for (const tour of tours) {
    test(`${tour.id} plays to the end in Auto`, async ({ page }) => {
      test.setTimeout(BASE_BUDGET_MS * 2 + tour.steps * STEP_BUDGET_MS);
      const session = sessions.get(tour.persona) ?? null;
      expect(session, `demo ${tour.persona} account`).not.toBeNull();
      await seedAutoTour(page, tour.id);

      await enterConsoleAs(page, session as ZygosSession, tour.route);

      await waitForFinish(page, tour);
    });
  }
}

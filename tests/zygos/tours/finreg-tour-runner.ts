import { expect, test } from '@playwright/test';
import { playAllToursInAuto } from '@dloizides/ui-tour/playwright';

import { enterConsoleAs, masterAccount, merchantAccount, resolveDemoAccounts, sessionFor } from '../zygos-master.js';

import type { ZygosSession } from '../zygos-session.js';

export interface TourCase {
  readonly id: string;
  readonly persona: 'master' | 'merchant';
  readonly route: string;
  readonly steps: number;
}

const STEP_BUDGET_MS = 9_000;
const BASE_BUDGET_MS = 60_000;

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
      await enterConsoleAs(page, session as ZygosSession, tour.route);

      const [run] = await playAllToursInAuto(page, { ids: [tour.id] });

      expect(run, run?.message ?? `${tour.id} produced no run`).toMatchObject({ tourId: tour.id, passed: true, step: tour.steps, steps: tour.steps });
    });
  }
}

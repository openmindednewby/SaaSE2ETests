import { devices } from '@playwright/test';
import type { Project } from '@playwright/test';

import { MOBILE_FLOOR } from './fixtures/mobile-gates.js';

const WALK_TIMEOUT_MS = 1_500_000;
const WALK_SPEC = /kucy-recreate\/kucy-recreate-ui\.spec\.ts/;

export function buildKucyRecreateUiProjects(): Project[] {
  return [
    { name: 'kucy-recreate-ui-mobile', workers: 1, timeout: WALK_TIMEOUT_MS, testMatch: WALK_SPEC, use: { ...MOBILE_FLOOR } },
    {
      name: 'kucy-recreate-ui-desktop',
      workers: 1,
      timeout: WALK_TIMEOUT_MS,
      testMatch: WALK_SPEC,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ];
}

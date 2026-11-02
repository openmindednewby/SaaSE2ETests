import { devices } from '@playwright/test';
import type { Project } from '@playwright/test';

const WIZARD_TIMEOUT_MS = 600_000;
const WIZARD_SPEC = /kefi\/kefi-wizard-full\.spec\.ts/;

export function buildKefiWizardProjects(): Project[] {
  return [
    {
      name: 'kefi-wizard-mobile',
      workers: 1,
      timeout: WIZARD_TIMEOUT_MS,
      testMatch: WIZARD_SPEC,
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 } },
    },
    {
      name: 'kefi-wizard-desktop',
      workers: 1,
      timeout: WIZARD_TIMEOUT_MS,
      testMatch: WIZARD_SPEC,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ];
}

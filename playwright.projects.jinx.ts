import { devices } from '@playwright/test';
import type { Project } from '@playwright/test';

const UNCONFIGURED_HOST = 'http://unconfigured.invalid';

export function buildJinxProjects(): Project[] {
  return [
    {
      name: 'jinx',
      testMatch: /tests[/\\]jinx[/\\].*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.JINX_SITE_URL || UNCONFIGURED_HOST },
    },
  ];
}

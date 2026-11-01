import { devices } from '@playwright/test';
import type { Project } from '@playwright/test';

const INCLUDE_FLAG = 'E2E_INCLUDE_JINX';
const UNCONFIGURED_HOST = 'http://unconfigured.invalid';

function isJinxRequested(): boolean {
  const args = process.argv;
  const namedOnCommandLine = args.some(
    (arg, i) => arg === '--project=jinx' || (arg === '--project' && args[i + 1] === 'jinx'),
  );
  if (namedOnCommandLine) process.env[INCLUDE_FLAG] = '1';
  return process.env[INCLUDE_FLAG] === '1';
}

export function buildJinxProjects(): Project[] {
  if (!isJinxRequested()) return [];
  return [
    {
      name: 'jinx',
      testMatch: /tests[/\\]jinx[/\\].*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.JINX_SITE_URL || UNCONFIGURED_HOST },
    },
  ];
}

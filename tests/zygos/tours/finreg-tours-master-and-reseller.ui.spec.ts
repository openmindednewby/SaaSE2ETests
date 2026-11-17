import { test } from '@playwright/test';

import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'merchants-list', persona: 'master', route: '/master/merchants', steps: 4 },
  { id: 'portfolio-open-a-merchant-exit', persona: 'master', route: '/master', steps: 5 },
  { id: 'reporting-and-audit-log', persona: 'master', route: '/master/reporting', steps: 5 },
];

test.describe('TOUR-1 finreg tours: masterAndReseller', () => {
  runTourCategory(TOURS);
});

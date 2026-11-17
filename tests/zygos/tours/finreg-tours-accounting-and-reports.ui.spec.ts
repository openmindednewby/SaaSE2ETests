import { test } from '@playwright/test';

import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'chart-of-accounts-and-a-ledger', persona: 'merchant', route: '/accounting', steps: 4 },
  { id: 'financial-statements', persona: 'merchant', route: '/accounting/trial-balance', steps: 5 },
  { id: 'journals', persona: 'merchant', route: '/accounting/journals', steps: 4 },
];

test.describe('TOUR-1 finreg tours: accountingAndReports', () => {
  runTourCategory(TOURS);
});

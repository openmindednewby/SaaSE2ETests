import { test } from '@playwright/test';

import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'find-a-payee', persona: 'merchant', route: '/payees', steps: 3 },
  { id: 'new-payee-end-to-end-saves-on-the-demo-tenant', persona: 'merchant', route: '/payees', steps: 17 },
  { id: 'uk-payee-sort-code-and-account-number', persona: 'merchant', route: '/payees/new', steps: 6 },
];

test.describe('TOUR-1 finreg tours: payees', () => {
  runTourCategory(TOURS);
});

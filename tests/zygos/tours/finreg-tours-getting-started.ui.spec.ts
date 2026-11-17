import { test } from '@playwright/test';

import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'module-home-payments-crm-accounting', persona: 'merchant', route: '/modules', steps: 6 },
  { id: 'page-help-on-every-screen', persona: 'merchant', route: '/instructions', steps: 4 },
];

test.describe('TOUR-1 finreg tours: gettingStarted', () => {
  runTourCategory(TOURS);
});

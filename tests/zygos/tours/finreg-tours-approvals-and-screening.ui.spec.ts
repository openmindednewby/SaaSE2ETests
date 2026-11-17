import { test } from '@playwright/test';

import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'maker-checker-queue', persona: 'merchant', route: '/approvals', steps: 6 },
  { id: 'screening-hold', persona: 'merchant', route: '/instructions', steps: 5 },
];

test.describe('TOUR-1 finreg tours: approvalsAndScreening', () => {
  runTourCategory(TOURS);
});

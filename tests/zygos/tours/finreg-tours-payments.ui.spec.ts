import { test } from '@playwright/test';

import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'batches-and-spreadsheet-import', persona: 'merchant', route: '/batches', steps: 4 },
  { id: 'dashboard-to-a-filtered-list', persona: 'merchant', route: '/', steps: 5 },
  { id: 'new-instruction-form-every-field', persona: 'merchant', route: '/instructions/new', steps: 34 },
  { id: 'open-an-instruction-and-its-audit-trail', persona: 'merchant', route: '/instructions', steps: 6 },
  { id: 'reconciliation-and-commission', persona: 'merchant', route: '/reconciliation', steps: 4 },
  { id: 'recurring-schedules', persona: 'merchant', route: '/schedules', steps: 4 },
];

test.describe('TOUR-1 finreg tours: payments', () => {
  runTourCategory(TOURS);
});

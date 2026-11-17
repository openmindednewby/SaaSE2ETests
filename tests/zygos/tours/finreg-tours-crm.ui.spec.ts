import { test } from '@playwright/test';

import { runTourCategory } from './finreg-tour-runner.js';

import type { TourCase } from './finreg-tour-runner.js';

const TOURS: readonly TourCase[] = [
  { id: 'contacts-people-and-organizations', persona: 'merchant', route: '/crm/contacts', steps: 6 },
  { id: 'crm-dashboard', persona: 'merchant', route: '/crm/dashboard', steps: 4 },
  { id: 'deals-pipeline', persona: 'merchant', route: '/crm/deals', steps: 4 },
  { id: 'tasks-and-segments', persona: 'merchant', route: '/crm/tasks', steps: 6 },
];

test.describe('TOUR-1 finreg tours: crm', () => {
  runTourCategory(TOURS);
});

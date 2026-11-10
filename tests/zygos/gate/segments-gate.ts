import { expect } from '@playwright/test';

import { ZYGOS_USERS } from '../zygos-helpers.js';
import { byPrefix, enterAs, id } from './finreg-gate.js';

import type { Page } from '@playwright/test';

export const SEG = {
  screen: 'zygos-segments-screen',
  card: 'zygos-segment-card',
  open: 'zygos-segment-card-open',
  edit: 'zygos-segment-card-edit',
  del: 'zygos-segment-card-delete',
  rule: 'zygos-segment-rule',
  preview: 'zygos-segment-members-preview',
  submit: 'zygos-segment-form-submit',
  name: 'segment-form-name',
  tags: 'segment-form-tags',
  count: 'zygos-segment-editor-count',
  members: 'zygos-segment-editor-members',
  detail: 'zygos-segment-detail-screen',
} as const;

export const LIST_PATH = '/crm/segments';
export const NEW_PATH = '/crm/segments/new';
export const GATE_SEGMENT = { name: 'e2e-gate segment', tags: 'vip' } as const;

export async function ensureGateSegment(page: Page): Promise<void> {
  await enterAs(page, ZYGOS_USERS.ADMIN, LIST_PATH);
  await expect(page.locator(id(SEG.screen))).toBeVisible({ timeout: 20_000 });
  if (await page.getByText(GATE_SEGMENT.name, { exact: true }).count()) return;
  await page.goto(NEW_PATH);
  await page.locator(id(SEG.name)).fill(GATE_SEGMENT.name);
  await page.locator(id(SEG.tags)).fill(GATE_SEGMENT.tags);
  await page.locator(id(SEG.submit)).click();
  await expect(page.locator(id(SEG.screen))).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(byPrefix(SEG.card)).first()).toBeVisible();
}

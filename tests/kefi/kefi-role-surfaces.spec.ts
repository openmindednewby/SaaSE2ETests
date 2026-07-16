/**
 * Kefi role-surface render smoke E2E (task #276 gap #5).
 *
 * Crew login already proves the TOKEN carries the role (crew-lifecycle @api), but
 * never that each role's SURFACE actually loads — precisely the "mounts but does
 * nothing / crashes" class MEMORY flags. This logs in as each role and asserts its
 * dashboard renders without tripping the app error boundary:
 *
 *   DJ         → /dj      → kefi-dj-page
 *   Media      → /media   → kefi-media-page
 *   Ambassador → /ambassador → kefi-ambassador-page
 *   Audit      → /audit   → kefi-audit-page   (organizer / tenant-owner surface)
 *
 * Each role is a distinct user in a fresh browser context (its own BFF session).
 * The page-level testID sits on the shared AppShell root, so it is present as soon
 * as the surface mounts; asserting the error-boundary reload button is ABSENT
 * proves the surface did not crash. Cheap, high signal-per-line.
 *
 * `@ui`. Master-admin provisions the role users (staging only; prod self-skips).
 * WRITE + COMPILE-verified — the authed run lands post-F1-kefi.
 */

import { test, expect } from '@playwright/test';

import { KefiLoginPage } from '../../pages/kefi/KefiLoginPage.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import {
  provisionApiTenantWithEvent,
  teardownApiTenant,
} from '../../helpers/kefi/kefiApiTenant.js';
import {
  createTenantUserWithRole,
  deleteEphemeralUser,
  masterAdminAvailable,
} from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const EVENT_DAYS_AHEAD = 90;
const PASS = { code: 'FULL', label: 'Full Pass', priceEur: 0 } as const;

interface RoleSurface {
  role: string;
  /** null → reuse the tenant owner (the audit surface is the organizer/tenant-owner one). */
  provisionRole: string | null;
  path: string;
  pageTestId: string;
  lastName: string;
}

const ROLE_SURFACES: RoleSurface[] = [
  { role: 'dj', provisionRole: 'dj', path: '/dj', pageTestId: 'kefi-dj-page', lastName: 'Dj' },
  { role: 'media', provisionRole: 'media', path: '/media', pageTestId: 'kefi-media-page', lastName: 'Media' },
  { role: 'ambassador', provisionRole: 'ambassador', path: '/ambassador', pageTestId: 'kefi-ambassador-page', lastName: 'Ambassador' },
  { role: 'audit', provisionRole: null, path: '/audit', pageTestId: 'kefi-audit-page', lastName: 'Audit' },
];

test.describe('Kefi role surfaces render for their role (#276)', () => {
  test.skip(
    !isRemoteTarget(),
    'Kefi role-surface E2E targets staging+prod; local stack not wired in dev-loop yet',
  );

  test('@ui dj / media / ambassador / audit dashboards render without an error boundary', async ({ browser }) => {
    test.skip(
      !masterAdminAvailable(),
      'The role-surface smoke provisions the role users via KC master-admin; only staging carries those creds.',
    );
    const admin = new KefiAdminClient();
    const { webUrl } = getKefiUrls();

    const handle = await provisionApiTenantWithEvent({
      admin,
      eventDaysAhead: EVENT_DAYS_AHEAD,
      eventStatus: 'Published',
      passCode: PASS.code,
      passLabel: PASS.label,
      priceEur: PASS.priceEur,
    });
    test.info().annotations.push({ type: 'canaryId', description: handle.ctx.canaryId });
    const provisionedUserIds: string[] = [];

    try {
      for (const surface of ROLE_SURFACES) {
        // Resolve the credentials for this surface — a dedicated role user, or the
        // tenant owner for the audit (organizer/tenant-owner) surface.
        let email = handle.ownerCreds.ownerEmail;
        if (surface.provisionRole !== null) {
          email = handle.ctx.email.replace('@', `-${surface.role}@`);
          const user = await createTenantUserWithRole({
            email,
            password: handle.ctx.password,
            tenantId: handle.tenantId,
            role: surface.provisionRole,
            lastName: surface.lastName,
          });
          provisionedUserIds.push(user.userId);
        }

        const context = await browser.newContext();
        const page = await context.newPage();
        try {
          const login = new KefiLoginPage(page);
          await login.goto();
          await login.signIn({ email, password: handle.ctx.password });
          await page.goto(`${webUrl}${surface.path}`);

          await expect(
            page.getByTestId(surface.pageTestId),
            `${surface.role} surface (${surface.path}) renders`,
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            page.getByTestId('error-boundary-reload-button'),
            `${surface.role} surface did not trip the app error boundary`,
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    } finally {
      for (const id of provisionedUserIds) await deleteEphemeralUser(id);
      await teardownApiTenant(handle, admin);
    }
  });
});

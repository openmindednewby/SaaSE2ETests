/**
 * Poueni canary-cleanup E2E (#188/#184) — verifies the purge endpoint AND
 * doubles as the recurring teardown: every run signs up one canary tenant, then
 * calls DELETE /v1/admin/canary-cleanup, which sweeps EVERY poueni E2E canary
 * tenant (the e2e-kefi-bot+poueni- email prefix) + its KC user + data. So on the
 * nightly suite this drains whatever the other poueni specs left behind, closing
 * the prod canary-debris gap from #184.
 *
 * Tagged @poueni @canary. Remote-only (prod/staging) — needs real Maddy + KC + API.
 */
import { test, expect } from '@playwright/test';

import { getPoueniUrls } from '../../helpers/poueni/poueniUrls.js';
import { newPoueniCanaryEmail } from '../../helpers/poueni/poueniMailbox.js';
import { signup, readVerifyUrl, login } from '../../helpers/poueni/poueniAuth.js';
import { isRemoteTarget } from '../../helpers/target.js';

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'CleanupPoueniPass-123';
const urls = getPoueniUrls();

interface CleanupResult {
  tenantsDeleted: number;
  kcUsersDeleted: number;
  contributionsDeleted: number;
}

test.describe('Poueni canary cleanup @poueni @canary', () => {
  test.skip(!isRemoteTarget(), 'Poueni canary-cleanup E2E targets prod/staging (real Maddy + KC + API); no local stack');

  test('purges canary tenants (and drains leftover debris) @critical', async ({ page, request }) => {
    const email = newPoueniCanaryEmail();
    test.info().annotations.push({ type: 'canaryEmail', description: email });

    // Create one canary tenant so there's guaranteed >=1 to purge.
    await signup(request, email, PASSWORD, 'E2E Cleanup Lab');
    const verifyUrl = await readVerifyUrl(email);
    expect((await request.get(verifyUrl)).status(), 'verify ok').toBe(200);

    // Authenticate, then call the cleanup through the BFF (in-page fetch so the
    // dashboard Origin satisfies the BFF CSRF check).
    await login(page, email, PASSWORD);
    const result = await page.evaluate(async () => {
      const res = await fetch('/bff/api/poueni/v1/admin/canary-cleanup', {
        method: 'DELETE',
        headers: { 'X-BFF-Csrf': '1', Accept: 'application/json' },
        credentials: 'same-origin',
      });
      return { status: res.status, text: await res.text() };
    });
    expect(result.status, `cleanup should succeed (got ${result.status}: ${result.text})`).toBe(200);

    const body = JSON.parse(result.text) as CleanupResult;
    // At least the tenant we just created (+ its KC user) is purged; the sweep
    // also drains any canary tenants the other poueni specs left behind.
    expect(body.tenantsDeleted, 'at least one canary tenant purged').toBeGreaterThanOrEqual(1);
    expect(body.kcUsersDeleted, 'at least one canary KC user purged').toBeGreaterThanOrEqual(1);

    // The purge removed our tenant + KC user, so the original password no longer
    // logs in (the account is gone). A fresh /login attempt must NOT navigate
    // off /login.
    await page.context().clearCookies();
    await page.goto(`${urls.dashboardUrl}/login`);
    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    const landed = await page
      .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    expect(landed, 'purged tenant must no longer be able to log in').toBe(false);
  });
});

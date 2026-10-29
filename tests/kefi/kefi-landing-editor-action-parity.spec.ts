import { test, expect, devices, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { MOBILE_FLOOR } from '../../fixtures/mobile-gates.js';
import { KefiAdminClient } from '../../helpers/kefi/kefiAdminClient.js';
import { provisionApiTenantWithEvent, teardownApiTenant, type ApiTenantHandle } from '../../helpers/kefi/kefiApiTenant.js';
import { bffLogin } from '../../helpers/kefi/kefiBrowserLogin.js';
import {
  addRealmRole,
  createTenantUserWithRole,
  deleteEphemeralUser,
  masterAdminAvailable,
  type EphemeralKefiUser,
} from '../../helpers/kefi/kefiKeycloakAdmin.js';
import { getKefiUrls } from '../../helpers/kefi/kefiUrls.js';
import { isRemoteTarget } from '../../helpers/target.js';

const DEVICES = [
  { name: '360x640 Galaxy S5', use: MOBILE_FLOOR },
  { name: '1280x800 Desktop Chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
] as const;
const EDITOR_PATH = '/organizer/landing';
const SHELL_TIMEOUT = 45_000;
const MENU_OPEN_TIMEOUT = 3_000;
const CANARY_PREFIX = 'e2c-';
const STUB_PUBLISH = { status: 'Enqueued', enqueuedAtUtc: '2026-10-29T00:00:00Z', message: 'Stubbed by the parity spec' };

test.describe.configure({ mode: 'serial' });

test.describe('KEFI-EDITOR-HEADER-1 landing editor action parity', () => {
  test.skip(!isRemoteTarget(), 'Drives the deployed kefi-web landing editor');
  test.skip(!masterAdminAvailable(), 'Provisions a canary tenant + user via KC master-admin; export KEYCLOAK_MASTER_ADMIN_*.');

  const admin = new KefiAdminClient();
  let tenant: ApiTenantHandle | undefined;
  let user: EphemeralKefiUser | undefined;

  test.beforeAll(async () => {
    tenant = await provisionApiTenantWithEvent({ admin, eventDaysAhead: 90, eventStatus: 'Published', passCode: 'FULL', passLabel: 'Full Pass', priceEur: 0 });
    if (!tenant.slug.startsWith(CANARY_PREFIX)) throw new Error(`refusing non-canary tenant '${tenant.slug}'`);
    user = await createTenantUserWithRole({
      email: tenant.ctx.email.replace('@', '-parity@'),
      password: tenant.ctx.password,
      tenantId: tenant.tenantId,
      role: 'organizer',
      firstName: 'Parity',
      lastName: 'Organizer',
    });
    await addRealmRole(user.userId, 'tenant-owner');
  });

  test.afterAll(async () => {
    if (user) await deleteEphemeralUser(user.userId);
    if (tenant) await teardownApiTenant(tenant, admin);
  });

  for (const device of DEVICES) {
    test.describe(device.name, () => {
      let context: BrowserContext;
      let page: Page;
      const webUrl = (): string => getKefiUrls().webUrl;
      const slug = (): string => tenant?.slug ?? '';
      const livePath = (): RegExp => new RegExp(`^/t/${slug()}/?$`);

      test.beforeAll(async ({ browser }) => {
        context = await browser.newContext({ ...device.use, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
        page = await context.newPage();
        await page.goto(`${webUrl()}/login`, { waitUntil: 'domcontentloaded' });
        await bffLogin(page, { username: user?.username ?? '', password: user?.password ?? '' });
      });

      test.afterAll(async () => {
        await context?.close();
      });

      test.beforeEach(async () => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.goto(`${webUrl()}${EDITOR_PATH}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('landing-editor-surface'), 'the landing editor mounted').toBeAttached({ timeout: SHELL_TIMEOUT });
      });

      async function reveal(target: Locator, what: string): Promise<Locator> {
        await target.or(page.locator('[aria-haspopup]:visible, [aria-expanded="false"]:visible')).first().waitFor({ timeout: SHELL_TIMEOUT });
        if (await target.isVisible()) return target;
        const triggers = page.locator('[aria-haspopup]:visible, [aria-expanded="false"]:visible');
        const count = await triggers.count();
        for (let i = 0; i < count; i += 1) {
          await triggers.nth(i).click();
          const opened = await target.waitFor({ state: 'visible', timeout: MENU_OPEN_TIMEOUT }).then(() => true, () => false);
          if (opened) return target;
          await page.keyboard.press('Escape');
          await expect(target, `${what} is not left on screen by a closing menu`).toBeHidden();
        }
        await expect(target, `${what} is on screen or behind a menu / popover trigger`).toBeVisible();
        return target;
      }

      async function stubPublish(): Promise<string[]> {
        const sent: string[] = [];
        await page.route('**/admin/landing-config/publish', async (route) => {
          sent.push(route.request().method());
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...STUB_PUBLISH, tenantSlug: slug() }) });
        });
        return sent;
      }

      async function publishStubbed(): Promise<void> {
        await stubPublish();
        await (await reveal(page.getByTestId('landing-editor-publish'), 'Publish')).click();
        await expect(page.getByTestId('landing-share-row'), 'the share row appears after a publish').toBeVisible({ timeout: SHELL_TIMEOUT });
      }

      async function openedPath(trigger: Locator): Promise<string> {
        const [popup] = await Promise.all([context.waitForEvent('page'), trigger.click()]);
        await popup.waitForURL((u) => u.protocol.startsWith('http'));
        const path = new URL(popup.url()).pathname;
        await popup.close();
        return path;
      }

      test('R05-06 with an organizer + tenant-owner user, the dashboards heading and Admin pill are reachable and the pill opens /admin', async () => {
        const heading = await reveal(page.getByText('Your dashboards', { exact: true }).first(), 'row 5 "Your dashboards"');
        const adminPill = await reveal(page.getByTestId('kefi-dashboard-nav-admin'), 'row 6 Admin pill');

        await adminPill.click();

        await expect(heading, 'row 5 heading was rendered').toBeAttached();
        await expect(page, 'row 6 the Admin pill navigates to /admin').toHaveURL(/\/admin\/?(?:[?#].*)?$/, { timeout: SHELL_TIMEOUT });
      });

      test('R15-16 R18 when Save is pressed, Save and Publish are disabled until the PUT returns', async () => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => { release = resolve; });
        await page.route('**/admin/landing-config', async (route) => {
          if (route.request().method() !== 'PUT') return route.fallback();
          await held;
          return route.continue();
        });
        const save = await reveal(page.getByTestId('landing-editor-save'), 'row 15 Save');
        const publish = await reveal(page.getByTestId('landing-editor-publish'), 'row 17 Publish');
        await expect(save, 'row 15 Save is enabled before the click').toBeEnabled();
        const put = page.waitForResponse((r) => r.url().endsWith('/admin/landing-config') && r.request().method() === 'PUT');

        await save.click();

        await expect(save, 'row 16 Save is disabled while the save is in flight').toBeDisabled();
        await expect(publish, 'row 18 Publish is disabled while the save is in flight').toBeDisabled();
        release();
        expect((await put).status(), 'the Save click sent the landing-config PUT').toBe(200);
        await expect(save, 'row 16 Save is enabled again after the save').toBeEnabled();
      });

      test('R21-22 after a save, the unpublished notice and the save banner show', async () => {
        const save = await reveal(page.getByTestId('landing-editor-save'), 'row 15 Save');

        await save.click();

        await expect(page.getByTestId('landing-editor-unpublished-notice'), 'row 21 unpublished notice').toBeVisible({ timeout: SHELL_TIMEOUT });
        await expect(page.getByTestId('landing-editor-banner'), 'row 22 save feedback banner').toBeVisible();
      });

      test('R17 when Publish is pressed, one publish POST is sent (fulfilled in the browser, no rebuild)', async () => {
        const sent = await stubPublish();
        const publish = await reveal(page.getByTestId('landing-editor-publish'), 'row 17 Publish');

        await publish.click();

        await expect.poll(() => sent, { message: 'row 17 Publish sent exactly one POST' }).toEqual(['POST']);
      });

      test('R19-20 Open live site opens /t/<slug> and the live URL caption shows the same URL', async () => {
        const openLive = await reveal(page.getByTestId('landing-editor-open-live'), 'row 19 Open live site');
        const caption = await reveal(page.getByTestId('landing-editor-live-url'), 'row 20 live URL');

        const opened = await openedPath(openLive);

        expect(opened, 'row 19 opens the canary tenant live page').toMatch(livePath());
        await expect(caption, 'row 20 caption shows the same /t/<slug> URL').toContainText(`/t/${slug()}`);
      });

      test('R24-27 after a publish, the share row shows title, lead, URL and an enabled View button', async () => {
        await stubPublish();
        const publish = await reveal(page.getByTestId('landing-editor-publish'), 'row 17 Publish');

        await publish.click();

        const row = page.getByTestId('landing-share-row');
        await expect(row.getByText('Your page is live!'), 'row 24 share title').toBeVisible({ timeout: SHELL_TIMEOUT });
        await expect(row.getByText(/Share this link with your attendees/), 'row 25 share lead').toBeVisible();
        await expect(page.getByTestId('landing-share-url'), 'row 26 share URL').toContainText(`/t/${slug()}`);
        await expect(page.getByTestId('landing-share-view'), 'row 27 View button').toBeEnabled();
      });

      test('R27 the share View button opens the canary tenant live page', async () => {
        await publishStubbed();

        const opened = await openedPath(page.getByTestId('landing-share-view'));

        expect(opened, 'row 27 View opens /t/<slug>').toMatch(livePath());
      });

      test('R28-29 the share Copy button copies the link and shows the copy note', async () => {
        await publishStubbed();

        await page.getByTestId('landing-share-copy').click();

        await expect(page.getByTestId('landing-share-copy-note'), 'row 29 copy note').toHaveText('Link copied to clipboard.');
      });
    });
  }
});

// Zygos PWA / service-worker surface (ZY-PWA) — proves the app/+html.tsx shell and its
// service-worker registration actually reach the DEPLOYED host.
//
// ── The silent bug this exists to catch ───────────────────────────────────────────────────────
//
// 🔴 app/+html.tsx NEVER RENDERED. Expo Router only honours the custom RootHtml (app/+html.tsx)
// when the web export runs in `web.output: "static"` mode. Every scaffolded app shipped with the
// default "single" output, so Expo served its STOCK ~1.5 kB template instead — silently dropping
// the service-worker registration, the canonical link, robots, and the Open Graph tags. The build
// was green, the app loaded, and the PWA had NEVER registered on any user. Verified only by curl:
//
//     curl https://app.zygos.dloizides.com/service-worker.js   → 404 (before the fix)
//     served /login HTML                                        → no serviceWorker.register(...)
//
// A green build is not evidence for this class of bug — only a fetch of the live host is. So the
// join is a TEST against the deployed origin, and this is it. It fails the moment the export drops
// back to "single" (no registration in the shell) or the SW/manifest stop shipping (404).
import { expect, test } from '@playwright/test';

import { ZYGOS_WEB_URL, bodyText } from './zygos-helpers.js';

test.describe('Zygos PWA surface @zygos-api @api', () => {
  test('🔴 the served shell registers the service worker (app/+html.tsx reached the export)', async ({
    request,
  }) => {
    const res = await request.get(`${ZYGOS_WEB_URL}/`);
    expect(res.status(), `GET / failed: ${await bodyText(res)}`).toBe(200);
    const html = await res.text();

    // The registration lives ONLY in app/+html.tsx. If Expo served its stock template (the bug),
    // this substring is absent — the exact regression, asserted on the exact string.
    expect(
      html.includes("serviceWorker.register('/service-worker.js')"),
      `the served HTML does not register a service worker ⇒ app/+html.tsx did not reach the export ` +
        `(web.output is not "static", so Expo shipped its stock template).`,
    ).toBe(true);

    // The same drop takes the SEO/PWA head with it — assert two more markers so a partial
    // regression cannot slip through on the SW string alone.
    expect(html.includes('rel="canonical"'), 'canonical link missing ⇒ +html.tsx head was dropped').toBe(true);
    expect(html.includes('rel="manifest"'), 'manifest link missing ⇒ +html.tsx head was dropped').toBe(true);
  });

  test('🔴 /service-worker.js is served (not a 404) with a JavaScript content-type', async ({ request }) => {
    const res = await request.get(`${ZYGOS_WEB_URL}/service-worker.js`);
    expect(
      res.status(),
      `/service-worker.js is a ${res.status()} — the registration the shell points at resolves to nothing. ` +
        `Run \`npm run generate:sw\` in the build so public/service-worker.js ships into dist.`,
    ).toBe(200);

    const contentType = res.headers()['content-type'] ?? '';
    expect(
      contentType.includes('javascript'),
      `/service-worker.js served with content-type "${contentType}" — a browser will refuse to register it.`,
    ).toBe(true);

    const body = await res.text();
    expect(body.includes("addEventListener('fetch'"), 'served /service-worker.js has no fetch handler').toBe(true);
  });

  test('/manifest.json is served (installable PWA)', async ({ request }) => {
    const res = await request.get(`${ZYGOS_WEB_URL}/manifest.json`);
    expect(res.status(), `/manifest.json is a ${res.status()} — the shell links it but it is absent.`).toBe(200);
  });
});

test.describe('Zygos PWA registration @zygos-ui @ui', () => {
  test('🔴 the service worker actually takes control in a real browser', async ({ page }) => {
    // 🔴 MUST wait for the `load` event, not `domcontentloaded`: the registration is scheduled in
    // the +html.tsx `load` handler (behind requestIdleCallback). At domcontentloaded it has not even
    // been queued yet, and Playwright's headless idle-scheduler can starve requestIdleCallback long
    // past a short timeout — which is exactly why the earlier `domcontentloaded` + 15s wait flaked
    // while the SW controls the page within ~5s in a real interactive browser (verified by hand).
    // 'load' is REQUIRED here and is the subject of the test, not laziness. The registration is
    // scheduled inside the +html.tsx `load` handler; at 'domcontentloaded' it has not been queued
    // yet, so an actionable wait would be racing work that has not started. The actionable wait
    // still happens — it is `navigator.serviceWorker.ready` below — this only picks the lifecycle
    // point to start from.
    // eslint-disable-next-line no-wait-until-slow/no-wait-until-slow
    await page.goto(`${ZYGOS_WEB_URL}/`, { waitUntil: 'load' });

    // `navigator.serviceWorker.ready` is the CANONICAL "a worker is active for this scope" signal —
    // it resolves whenever activation completes, however late the idle callback fired, so it absorbs
    // the requestIdleCallback delay instead of racing it. Wrapped in waitForFunction (not awaited
    // raw) so a genuinely-never-registering shell fails with a clean timeout rather than hanging.
    const SW_TIMEOUT_MS = 30000;
    const activeUrl = await page.waitForFunction(
      async () => {
        if (!('serviceWorker' in navigator)) return null;
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.scriptURL ?? null;
      },
      undefined,
      { timeout: SW_TIMEOUT_MS, polling: 500 },
    );

    // One reload so the now-active worker is guaranteed to CONTROL the page (controller is only set
    // for pages that started under a worker, or after clients.claim() — a reload removes that race).
    // The reload IS the mechanism under test, not a workaround: `navigator.serviceWorker.controller`
    // is only set for a page that STARTED under a worker (or after clients.claim()), so a freshly
    // registered worker never controls the page that registered it. Reloading is the only way to
    // observe control, which is the property that actually matters to a user. 'load' for the same
    // reason as the initial navigation above.
    // eslint-disable-next-line no-page-reload/no-page-reload, no-wait-until-slow/no-wait-until-slow
    await page.reload({ waitUntil: 'load' });
    const controllerUrl = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return navigator.serviceWorker.controller?.scriptURL ?? registration?.active?.scriptURL ?? null;
    });
    void activeUrl;

    expect(
      controllerUrl,
      'no active/controlling service worker after load ⇒ registration never completed ' +
        '(the shell had no registration script, or /service-worker.js 404d).',
    ).not.toBeNull();
    expect(controllerUrl ?? '', 'the active worker is not our /service-worker.js').toContain('/service-worker.js');
  });
});

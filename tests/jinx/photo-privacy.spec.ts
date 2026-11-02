import { expect, test, type Page } from '@playwright/test';

import {
  bodiesOf,
  chooseFile,
  FLAG_APP_URL,
  makePhoto,
  openPhotoTab,
  recordTraffic,
  requestsCarryingPhoto,
} from './helpers/photo';
import { APP_URL } from './helpers/tracker';

const WAIT_FOR_VERDICT_MS = 30_000;
const NETWORK_IDLE_MS = 10_000;
const CHART_DONE = 'Chart made from your photo.';
const SKIN_APPLIED = 'The first colour is set to stand out against the tone you picked.';

async function quietNetwork(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS });
}

test('AC-34 Photo in converter and in skin-tone input, Run flow, record all requests, No request carries image bytes; request bodies equal the no-photo run', async ({ page, context }) => {
  const path = test.info().outputPath('photo-12mp.jpg');
  const file = await makePhoto(page, path);
  const traffic = await recordTraffic(page, context);
  await openPhotoTab(page);
  await quietNetwork(page);
  const noPhotoBodies = bodiesOf(traffic.requests);

  await chooseFile(page, 'jinx-photo-choose', path);

  await expect(page.getByTestId('jinx-photo-status')).toHaveText(CHART_DONE, { timeout: WAIT_FOR_VERDICT_MS });
  await quietNetwork(page);
  expect(requestsCarryingPhoto(traffic.requests, file)).toEqual([]);
  expect(traffic.sockets).toEqual([]);
  expect(bodiesOf(traffic.requests)).toEqual(noPhotoBodies);
});

test('AC-34 Photo in the flagged skin-tone input, Run flow, No request carries image bytes; request bodies equal the no-photo run', async ({ page, context }) => {
  const path = test.info().outputPath('photo-12mp.jpg');
  const file = await makePhoto(page, path);
  const traffic = await recordTraffic(page, context);
  await page.goto(`${FLAG_APP_URL}/colour`);
  await expect(page.getByTestId('jinx-advice-skin-photo')).toBeVisible();
  await quietNetwork(page);
  const noPhotoBodies = bodiesOf(traffic.requests);

  await chooseFile(page, 'jinx-advice-skin-photo', path);

  await expect(page.getByTestId('jinx-advice-note')).toContainText(SKIN_APPLIED, { timeout: WAIT_FOR_VERDICT_MS });
  await quietNetwork(page);
  expect(requestsCarryingPhoto(traffic.requests, file)).toEqual([]);
  expect(traffic.sockets).toEqual([]);
  expect(bodiesOf(traffic.requests)).toEqual(noPhotoBodies);
});

test('AC-34 recorder control, A worker and the page post the file, Both posts are recorded and the file is flagged', async ({ page, context }) => {
  const path = test.info().outputPath('photo-12mp.jpg');
  const file = await makePhoto(page, path);
  const traffic = await recordTraffic(page, context);
  const probe = `${APP_URL}/e2e-recorder-probe`;
  await context.route(probe, (route) => route.fulfill({ status: 204 }));
  await page.goto(APP_URL);

  const seen = await page.evaluate(
    async ({ url, data }) => {
      const blob = await (await fetch(`data:image/jpeg;base64,${data}`)).blob();
      await fetch(url, { method: 'POST', body: blob });
      const code = 'onmessage = async (e) => { await fetch(e.data.url, { method: "POST", body: "from-worker" }); postMessage("sent"); };';
      const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      return new Promise<string>((resolve) => {
        worker.onmessage = (event): void => resolve(String(event.data));
        worker.postMessage({ url });
      });
    },
    { url: probe, data: file.toString('base64') },
  );

  expect(seen).toBe('sent');
  const posts = traffic.requests.filter((request) => request.url === probe);
  expect(posts.map((post) => post.body?.toString().slice(0, 11))).toContain('from-worker');
  expect(requestsCarryingPhoto(posts, file)).toHaveLength(1);
});

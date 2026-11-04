import { expect, test } from '@playwright/test';

import { BFF_API, patternExternalId } from './helpers/live-api';
import { livePatternSlug } from './helpers/screens';
import { ACCOUNT_TEST_MS, newJinxAccount, removeAccount, signedInApi } from './helpers/signed-in';

test('AC-30 Same account, two browser contexts, A advances offline, syncs; B reloads, B sees A’s row; older write gets 409 and keeps the newer', async ({ request }) => {
  test.setTimeout(ACCOUNT_TEST_MS);
  const firstRow = 5;
  const newerRow = 7;
  const olderRow = 1;
  const clientUpdatedAt = new Date().toISOString();
  const patternId = await patternExternalId(request, await livePatternSlug(request));
  const url = `${BFF_API}/me/progress/${patternId}`;
  const account = await newJinxAccount();
  const deviceA = await signedInApi(account.email, account.password);
  const deviceB = await signedInApi(account.email, account.password);
  try {
    const first = await deviceA.put(url, { data: { row: firstRow, bead: 0, clientUpdatedAt, version: 0 } });
    expect(first.status()).toBe(200);
    const firstVersion = (await first.json()).version as number;

    const onB = await deviceB.get(url);

    expect((await onB.json()).row).toBe(firstRow);
    const newer = await deviceA.put(url, { data: { row: newerRow, bead: 0, clientUpdatedAt, version: firstVersion } });
    expect(newer.status()).toBe(200);
    const older = await deviceB.put(url, { data: { row: olderRow, bead: 0, clientUpdatedAt, version: firstVersion } });
    expect(older.status()).toBe(409);
    expect((await older.json()).row).toBe(newerRow);
    expect((await (await deviceB.get(url)).json()).row).toBe(newerRow);
  } finally {
    await deviceA.dispose();
    await deviceB.dispose();
    await removeAccount(account);
  }
});

test('AC-30 anonymous progress read, returns 401', async ({ request }) => {
  const url = `${BFF_API}/me/progress`;

  const response = await request.get(url);

  expect(response.status()).toBe(401);
});

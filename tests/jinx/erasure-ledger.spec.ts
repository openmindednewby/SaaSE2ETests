import { createTestAccount } from '@dloizides/e2e-helpers';
import { expect, test } from '@playwright/test';

import { jinxRows, ledgerOf, loginEnabled, patternOwner, startJinxApi, stopJinxApi, type JinxRows, type LedgerState } from './helpers/erasure-ops';
import { BFF_API, WRITE_HEADERS } from './helpers/live-api';
import { newJinxAccount, publishRandomChart, removeAccount, signedInApi, uniqueTitle } from './helpers/signed-in';
import { expectSignInGone, expungeLeftoverMail, hookedContext, newestMailbox } from './helpers/test-accounts';
import { APP_URL } from './helpers/tracker';

const FIRST_ATTEMPT_TIMEOUT_MS = 120_000;
const FIRST_ATTEMPT_POLL_MS = 5000;
const SWEEP_TIMEOUT_MS = 4_500_000;
const SWEEP_POLL_MS = 30_000;
const MS_PER_SECOND = 1000;
const REQUEST_PROCESSING = 3;
const REQUEST_COMPLETED = 4;
const LEDGER_PENDING = 0;
const LEDGER_CONFIRMED = 1;

test('AC-ER-9 an account deleted with jinx-api stopped stays open, after a start it completes with its rows at 0', async () => {
  let stoppedAt = 0;
  const account = await createTestAccount({
    app: 'jinx',
    baseUrl: APP_URL,
    mailbox: newestMailbox(),
    newContext: hookedContext(async (url, _options, send) => {
      if (url.includes('confirm-form')) {
        stopJinxApi();
        stoppedAt = Date.now();
      }
      return send();
    }),
  });
  const published1AndFavourited1: JinxRows = { patterns: 1, favourites: 1 };
  const arrange = async (): Promise<string> => {
    const api = await signedInApi(account.email, account.password);
    const published = await publishRandomChart(api, uniqueTitle('erasure'));
    const favourited = await api.put(`${BFF_API}/me/favourites/${published.externalId}`, { headers: WRITE_HEADERS, data: {} });
    expect(favourited.ok(), `PUT favourite ${favourited.status()}`).toBe(true);
    await api.dispose();
    const userId = patternOwner(published.externalId);
    expect(jinxRows(userId)).toEqual(published1AndFavourited1);
    expect(loginEnabled(userId)).toBe('t');
    return userId;
  };
  const userId = await arrange().catch(async (error: unknown) => {
    try {
      await account.dispose();
    } finally {
      startJinxApi();
    }
    throw error;
  });

  let whileStopped: { ledger: LedgerState; login: string; rows: JinxRows } | undefined;
  try {
    await account.dispose();
    await expect
      .poll(() => ledgerOf(userId).attempts, { message: 'first sweep attempt', intervals: [FIRST_ATTEMPT_POLL_MS], timeout: FIRST_ATTEMPT_TIMEOUT_MS })
      .toBeGreaterThan(0);
    whileStopped = { ledger: ledgerOf(userId), login: loginEnabled(userId), rows: jinxRows(userId) };
  } finally {
    startJinxApi();
    const outage = stoppedAt === 0 ? 0 : Math.round((Date.now() - stoppedAt) / MS_PER_SECOND);
    process.stdout.write(`erasure-ledger outage_seconds=${outage} user=${userId}\n`);
  }

  process.stdout.write(`erasure-ledger while_stopped=${JSON.stringify(whileStopped)}\n`);
  expect(whileStopped?.ledger).toMatchObject({ rows: 1, service: 'jinx-api', status: LEDGER_PENDING, requestStatus: REQUEST_PROCESSING, completedAt: '' });
  expect(whileStopped?.ledger.lastFailure).not.toBe('');
  expect(whileStopped?.login).toBe('f');
  expect(whileStopped?.rows).toEqual(published1AndFavourited1);

  const sweepNudge = await newJinxAccount();
  await removeAccount(sweepNudge);
  await expect
    .poll(() => ledgerOf(userId).requestStatus, { message: 'request Completed', intervals: [SWEEP_POLL_MS], timeout: SWEEP_TIMEOUT_MS })
    .toBe(REQUEST_COMPLETED);

  const finished = ledgerOf(userId);
  process.stdout.write(`erasure-ledger finished=${JSON.stringify(finished)}\n`);
  expect(finished).toMatchObject({ rows: 1, service: 'jinx-api', status: LEDGER_CONFIRMED, readBack: '0' });
  expect(finished.confirmedAt).not.toBe('');
  expect(finished.buildSha).not.toBe('');
  expect(jinxRows(userId)).toEqual({ patterns: 0, favourites: 0 });
  expect(loginEnabled(userId)).toBe('');
  await expectSignInGone(account.email, account.password);
  await expungeLeftoverMail(account.email);
});

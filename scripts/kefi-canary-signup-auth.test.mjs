// Run: node --test scripts/kefi-canary-signup-auth.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { authorizeCanarySignup } from '../helpers/kefi/kefiCanarySignupAuth.ts';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function postSignupFromBrowser(tenantName, getBearer) {
  const seen = [];
  const api = await listen((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.end();
      return;
    }
    seen.push(req.headers.authorization ?? null);
    res.end('{}');
  });
  const site = await listen((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html></html>');
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(site.url);
    await authorizeCanarySignup(page, tenantName, getBearer);
    const status = await page.evaluate(async (url) => {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return resp.status;
    }, `${api.url}/api/v1/public/signup`);
    return { status, seen };
  } finally {
    await browser.close();
    api.server.close();
    site.server.close();
  }
}

test('KEFI-CANARY-LEAK-1 with a canary tenant name, signup POST carries the platform admin bearer', async () => {
  const getBearer = async () => 'admin-token';

  const { status, seen } = await postSignupFromBrowser('e2c-33b82b03-Canary Tenant', getBearer);

  assert.equal(status, 200);
  assert.deepEqual(seen, ['Bearer admin-token']);
});

test('KEFI-CANARY-LEAK-1 with a customer tenant name, signup POST has no bearer and no token is minted', async () => {
  let minted = 0;
  const getBearer = async () => {
    minted += 1;
    return 'admin-token';
  };

  const { seen } = await postSignupFromBrowser('Kizomba Union CY', getBearer);

  assert.deepEqual(seen, [null]);
  assert.equal(minted, 0);
});

test('KEFI-CANARY-LEAK-1 with a malformed canary name, signup POST has no bearer', async () => {
  const getBearer = async () => 'admin-token';

  const { seen } = await postSignupFromBrowser('e2c-notahex-Canary Tenant', getBearer);

  assert.deepEqual(seen, [null]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URLSearchParams } from 'node:url';
import {
  DEFAULT_CANARY_CLIENT_ID,
  DEFAULT_CANARY_REALM,
  canaryClientConfigFromEnv,
  mintCanaryServiceToken,
} from './canary-service-token.ts';

function fakeFetch(status, payload) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new globalThis.Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status });
  };
  return { impl, calls };
}

test('CANARY-SA-1 with no CANARY_CLIENT_SECRET, returns no config so setup falls back to password login', () => {
  const env = { CANARY_REALM: 'platform' };

  const config = canaryClientConfigFromEnv('https://kc.example', env);

  assert.equal(config, undefined);
});

test('CANARY-SA-1 with only the secret set, targets the platform realm and canary-cleanup client', () => {
  const env = { CANARY_CLIENT_SECRET: 's3cret' };

  const config = canaryClientConfigFromEnv('https://kc.example/', env);

  assert.equal(DEFAULT_CANARY_REALM, 'platform');
  assert.equal(DEFAULT_CANARY_CLIENT_ID, 'canary-cleanup');
  assert.deepEqual(config, {
    tokenUrl: 'https://kc.example/realms/platform/protocol/openid-connect/token',
    clientId: 'canary-cleanup',
    clientSecret: 's3cret',
  });
});

test('CANARY-SA-1 with a 200 token response, posts a client_credentials form and returns the access token', async () => {
  const config = { tokenUrl: 'https://kc.example/realms/ops/protocol/openid-connect/token', clientId: 'sweeper', clientSecret: 'abc' };
  const { impl, calls } = fakeFetch(200, { access_token: 'tok-123', expires_in: 300 });

  const token = await mintCanaryServiceToken(config, impl);

  assert.deepEqual(token, { accessToken: 'tok-123', expiresInSeconds: 300 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://kc.example/realms/ops/protocol/openid-connect/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].init.body)), {
    grant_type: 'client_credentials',
    client_id: 'sweeper',
    client_secret: 'abc',
  });
});

test('CANARY-SA-1 with a 401 token response, throws naming the client and status', async () => {
  const config = { tokenUrl: 'https://kc.example/t', clientId: 'sweeper', clientSecret: 'wrong' };
  const { impl } = fakeFetch(401, '{"error":"unauthorized_client"}');

  const mint = mintCanaryServiceToken(config, impl);

  await assert.rejects(mint, /"sweeper".*HTTP 401.*unauthorized_client/);
});

test('CANARY-SA-1 with a 200 response lacking access_token, throws instead of returning an empty token', async () => {
  const config = { tokenUrl: 'https://kc.example/t', clientId: 'sweeper', clientSecret: 'abc' };
  const { impl } = fakeFetch(200, { token_type: 'Bearer' });

  const mint = mintCanaryServiceToken(config, impl);

  await assert.rejects(mint, /returned no access_token/);
});

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
      if (specifier !== './http-agent.js') return next(specifier, context);
      return { url: 'data:text/javascript,export const sharedHttpsAgent = undefined;', shortCircuit: true };
    }`),
);
const { CANARY_CLEANUP_CLIENT_ID, PLATFORM_REALM, chooseCleanupToken, platformClientSecret, platformTokenUrl } =
  await import('./canary-cleanup-token.ts');

function recordingMint(result) {
  const calls = [];
  const mint = async (tokenUrl, clientId, clientSecret) => {
    calls.push({ tokenUrl, clientId, clientSecret });
    if (result instanceof Error) throw result;
    return result;
  };
  return { mint, calls };
}

test('CANARY-SA-1 with the per-target secret and the generic one set, prefers the per-target secret', () => {
  const env = { PLATFORM_CANARY_CLIENT_SECRET_STAGING: 'staging-secret', PLATFORM_CANARY_CLIENT_SECRET: 'generic' };

  const secret = platformClientSecret('staging', env);

  assert.equal(secret, 'staging-secret');
});

test('CANARY-SA-1 with only the generic secret set, falls back to it', () => {
  const env = { PLATFORM_CANARY_CLIENT_SECRET_STAGING: '', PLATFORM_CANARY_CLIENT_SECRET: 'generic' };

  const secret = platformClientSecret('staging', env);

  assert.equal(secret, 'generic');
});

test('CANARY-SA-1 with a product-realm issuer, derives the platform realm token URL', () => {
  const env = { KEYCLOAK_ISSUER: 'https://kc.example/realms/OnlineMenu' };

  const url = platformTokenUrl(env);

  assert.equal(PLATFORM_REALM, 'platform');
  assert.equal(url, 'https://kc.example/realms/platform/protocol/openid-connect/token');
});

test('CANARY-SA-1 with an explicit token URL, uses it over the issuer', () => {
  const env = { PLATFORM_CANARY_TOKEN_URL: 'https://kc.example/custom/token', KEYCLOAK_ISSUER: 'https://kc.example/realms/x' };

  const url = platformTokenUrl(env);

  assert.equal(url, 'https://kc.example/custom/token');
});

test('CANARY-SA-1 with no secret, returns no token so setup falls back to password login', async () => {
  const env = { KEYCLOAK_ISSUER: 'https://kc.example/realms/x' };
  const { mint, calls } = recordingMint('unused');

  const choice = await chooseCleanupToken('staging', null, env, mint);

  assert.deepEqual(choice, { token: null, source: 'none', note: 'PLATFORM_CANARY_CLIENT_SECRET_STAGING unset' });
  assert.equal(calls.length, 0);
});

test('CANARY-SA-1 with the secret and issuer set, mints the canary-cleanup client token in the platform realm', async () => {
  const env = { PLATFORM_CANARY_CLIENT_SECRET_STAGING: 's3cret', KEYCLOAK_ISSUER: 'https://kc.example/realms/x' };
  const { mint, calls } = recordingMint('tok-123');

  const choice = await chooseCleanupToken('staging', 'user-tok', env, mint);

  assert.equal(CANARY_CLEANUP_CLIENT_ID, 'canary-cleanup');
  assert.equal(choice.token, 'tok-123');
  assert.equal(choice.source, 'platform-client');
  assert.deepEqual(calls, [
    { tokenUrl: 'https://kc.example/realms/platform/protocol/openid-connect/token', clientId: 'canary-cleanup', clientSecret: 's3cret' },
  ]);
});

test('CANARY-SA-1 with a failing mint and a user token, falls back to the user token naming the error', async () => {
  const env = { PLATFORM_CANARY_CLIENT_SECRET_STAGING: 'wrong', KEYCLOAK_ISSUER: 'https://kc.example/realms/x' };
  const { mint } = recordingMint(new Error('client_credentials mint at u returned HTTP 401'));

  const choice = await chooseCleanupToken('staging', 'user-tok', env, mint);

  assert.deepEqual(choice, { token: 'user-tok', source: 'user-token', note: 'client_credentials mint at u returned HTTP 401' });
});

test('CANARY-SA-1 with the secret but no issuer, returns no token instead of guessing a URL', async () => {
  const env = { PLATFORM_CANARY_CLIENT_SECRET_STAGING: 's3cret' };
  const { mint, calls } = recordingMint('unused');

  const choice = await chooseCleanupToken('staging', null, env, mint);

  assert.equal(choice.token, null);
  assert.equal(choice.note, 'no platform token URL (KEYCLOAK_ISSUER unset)');
  assert.equal(calls.length, 0);
});

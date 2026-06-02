/**
 * Katalogos device-PIN + passkey E2E (unified-login Increment 3, Batch 3).
 *
 * Thin caller of the shared {@link defineLoginMethodsSuite} — the suite body
 * (PIN enrol/unlock/lockout/disable + passkey register/login/forged-callback)
 * lives in helpers/login-methods-suite.ts and is reused by every product that
 * rolled out the unified login methods. Project: `katalogos-login-methods`
 * (the global baseURL = katalogos-web per E2E_TARGET).
 */

import { test } from '@playwright/test';

import { defineLoginMethodsSuite } from '../../helpers/login-methods-suite.js';

// Serial — both tests share the seeded user + the per-IP BffAuth rate limiter.
test.describe.configure({ mode: 'serial' });

defineLoginMethodsSuite({
  product: 'Katalogos',
  sessionCookie: '__Host-bff-katalogos',
  deviceCookie: '__Host-bffdev-katalogos',
  testIdPrefix: 'katalogos',
});

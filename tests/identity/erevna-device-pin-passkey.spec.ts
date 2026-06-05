/**
 * Erevna device-PIN + passkey E2E (unified-login Increment 3, Batch 4).
 *
 * Thin caller of the shared {@link defineLoginMethodsSuite} — the suite body
 * lives in helpers/login-methods-suite.ts. Project: `erevna-login-methods`
 * (baseURL = EREVNA_BASE_URL per E2E_TARGET; realm: questioner).
 */

import { test } from '@playwright/test';

import { defineLoginMethodsSuite } from '../../helpers/login-methods-suite.js';

// Serial — both tests share the seeded user + the per-IP BffAuth rate limiter.
test.describe.configure({ mode: 'serial' });

defineLoginMethodsSuite({
  product: 'Erevna',
  sessionCookie: '__Host-bff-erevna',
  deviceCookie: '__Host-bffdev-erevna',
  testIdPrefix: 'erevna',
  otpEmailTag: 'otp-erevna',
});

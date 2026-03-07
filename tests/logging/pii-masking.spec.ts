/**
 * PII Masking E2E Tests
 *
 * Validates that Personally Identifiable Information (PII) is properly
 * masked in log output stored in Loki:
 * - Email addresses are masked (not stored raw)
 * - Phone numbers are masked (not stored raw)
 */

import { test, expect } from '@playwright/test';

import { LokiClient } from '../../helpers/loki-client.js';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const IDENTITY_URL =
  process.env.IDENTITY_API_URL ?? 'http://localhost:5002';

/** Timeout for waiting for logs to propagate */
const LOG_PROPAGATION_TIMEOUT_MS = 15000;

/** Test email that should be masked in logs */
const TEST_EMAIL = 'e2e-pii-test@example.com';

/** Test phone number that should be masked in logs */
const TEST_PHONE = '+1-555-867-5309';

test.describe('PII Masking @logging', () => {
  let loki: LokiClient;

  test.beforeAll(async () => {
    loki = new LokiClient(LOKI_URL);

    const ready = await loki.isReady();
    if (!ready) {
      throw new Error('Loki is not ready. Cannot run PII masking tests.');
    }
  });

  test('email addresses are masked in logs', async ({ request }) => {
    // Trigger a request that would log an email address
    // Use a login attempt (expected to fail) which should log the email
    await request
      .post(`${IDENTITY_URL}/api/auth/login`, {
        data: {
          method: 0,
          username: TEST_EMAIL,
          password: 'invalid-password-for-e2e-pii-test',
        },
        timeout: 10000,
      })
      .catch(() => null);

    // Wait for logs to propagate
    // Search broadly for any log containing the email domain
    // (the masking may change the local part but domain might still appear)
    await expect(async () => {
      // Query for the domain part which may still appear in masked form
      const result = await loki.queryRange(
        '{ServiceName=~".+"} |~ `example.com`',
        { limit: 50 }
      );

      // If no logs mention example.com at all, the test is inconclusive
      // but still valid (the email may have been completely masked)
      const entries = LokiClient.flattenEntries(result);

      if (entries.length > 0) {
        // Verify that the RAW email does NOT appear in any log line
        for (const entry of entries) {
          expect(
            entry.line,
            `Raw email "${TEST_EMAIL}" should not appear in logs (PII leak)`
          ).not.toContain(TEST_EMAIL);
        }
      }

      // The query succeeded regardless
      expect(result.status).toBe('success');
    }).toPass({ timeout: LOG_PROPAGATION_TIMEOUT_MS });

    // Also do a direct search for the raw email across ALL logs
    const rawSearch = await loki.queryRange(
      `{ServiceName=~".+"} |= \`${TEST_EMAIL}\``,
      { limit: 10 }
    );

    const rawCount = LokiClient.countEntries(rawSearch);
    expect(
      rawCount,
      `Raw email "${TEST_EMAIL}" should not appear unmasked in any log`
    ).toBe(0);

    test.info().annotations.push({
      type: 'info',
      description: rawCount === 0
        ? 'Email PII masking verified: raw email not found in logs'
        : `WARNING: Found ${rawCount} log entries with unmasked email`,
    });
  });

  test('phone numbers are masked in logs', async ({ request }) => {
    // Trigger a request that would log a phone number
    // Attempt a user lookup by phone (may not exist, but triggers logging)
    await request
      .post(`${IDENTITY_URL}/api/users/lookup`, {
        data: { phone: TEST_PHONE },
        timeout: 10000,
      })
      .catch(() => null);

    // Also try registration which may log phone numbers
    await request
      .post(`${IDENTITY_URL}/api/auth/register`, {
        data: {
          username: 'e2e-pii-phone-test',
          password: 'invalid',
          phone: TEST_PHONE,
        },
        timeout: 10000,
      })
      .catch(() => null);

    // Search Loki for the raw phone number
    const rawSearch = await loki.queryRange(
      `{ServiceName=~".+"} |= \`${TEST_PHONE}\``,
      { limit: 10 }
    );

    const rawCount = LokiClient.countEntries(rawSearch);
    expect(
      rawCount,
      `Raw phone number "${TEST_PHONE}" should not appear unmasked in any log`
    ).toBe(0);

    // Also check without the country code prefix
    const phoneDigits = TEST_PHONE.replace(/\D/g, '');
    const digitSearch = await loki.queryRange(
      `{ServiceName=~".+"} |= \`${phoneDigits}\``,
      { limit: 10 }
    );

    const digitCount = LokiClient.countEntries(digitSearch);
    expect(
      digitCount,
      `Raw phone digits "${phoneDigits}" should not appear unmasked in any log`
    ).toBe(0);

    test.info().annotations.push({
      type: 'info',
      description:
        rawCount === 0 && digitCount === 0
          ? 'Phone PII masking verified: raw phone number not found in logs'
          : `WARNING: Found raw phone data in ${rawCount + digitCount} log entries`,
    });
  });
});

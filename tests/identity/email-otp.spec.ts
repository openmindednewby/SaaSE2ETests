import { setTimeout as delay } from 'timers/promises';
import { test, expect } from '@playwright/test';
import axios from 'axios';
import { AuthHelper } from '../../helpers/auth-helper.js';
import {
  waitForEmailContent,
  isMailpitHealthy,
} from '../../helpers/mailpit.helpers.js';

const IDENTITY_API_URL = process.env.IDENTITY_API_URL || 'http://localhost:5002';

/** Get a valid tenant ID from env or by querying the API. */
async function getFirstTenantId(): Promise<string | null> {
  if (process.env.TEST_TENANT_ID) return process.env.TEST_TENANT_ID;

  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;
  if (!username || !password) return null;

  try {
    const auth = new AuthHelper();
    await auth.loginViaAPI(username, password);
    const client = auth.createAuthenticatedClient(`${IDENTITY_API_URL}/api/v1`);
    const response = await client.get('/tenants');
    if (Array.isArray(response.data) && response.data.length > 0) {
      return response.data[0].tenantId ?? null;
    }
  } catch {
    // Auth or tenants endpoint may not be available
  }
  return null;
}

/**
 * Send OTP via the identity API.
 * type 0 = SMS, type 1 = Email
 */
async function sendOtp(email: string, tenantId: string) {
  const response = await axios.post(
    `${IDENTITY_API_URL}/api/v1/auth/send-otp`,
    { type: 1, identifier: email, tenantId },
    { timeout: 15000 },
  );
  return response.data;
}

/** Generate a unique email for this test worker to avoid cross-browser conflicts. */
function uniqueEmail(prefix: string, projectName: string): string {
  const suffix = projectName.replace(/[^a-z0-9]/gi, '').substring(0, 8);
  return `${prefix}-${suffix}-${Date.now()}@example.com`;
}

test.describe('Email OTP Flow @identity @email', () => {
  test.slow();

  let tenantId: string;

  test.beforeAll(async () => {
    const healthy = await isMailpitHealthy();
    test.skip(!healthy, 'Mailpit is not running — skipping email tests');

    const id = await getFirstTenantId();
    test.skip(!id, 'No tenant available — skipping email OTP tests');
    tenantId = id!;
  });

  test.beforeEach(async () => {
    // TODO: Remove delay once identity API rate limiting is configurable per environment
    // Small delay between tests to avoid rate limiting (Auth policy: 5/min)
    await delay(500);
  });

  // eslint-disable-next-line no-empty-pattern
  test('send-otp with email type should deliver email to Mailpit', async ({}, testInfo) => {
    const testEmail = uniqueEmail('otp-test', testInfo.project.name);

    const otpResponse = await sendOtp(testEmail, tenantId);
    expect(otpResponse.success).toBe(true);
    expect(otpResponse.expiresIn).toBeGreaterThan(0);

    const email = await waitForEmailContent(testEmail);
    expect(email).not.toBeNull();
    expect(email!.Subject).toBe('Your Verification Code');
    expect(email!.To[0].Address).toBe(testEmail);
    expect(email!.From.Address).toBe('noreply@localhost');

    const bodyText = email!.Text || email!.HTML;
    expect(bodyText).toMatch(/verification code/i);
    expect(bodyText).toMatch(/\d{6}/);
  });

  // eslint-disable-next-line no-empty-pattern
  test('OTP code in email should match code returned in dev mode', async ({}, testInfo) => {
    const testEmail = uniqueEmail('otp-verify', testInfo.project.name);

    const otpResponse = await sendOtp(testEmail, tenantId);
    expect(otpResponse.success).toBe(true);

    test.skip(!otpResponse.code, 'Dev-mode OTP code not exposed — skipping code matching');

    const email = await waitForEmailContent(testEmail);
    expect(email).not.toBeNull();

    const bodyText = email!.Text || email!.HTML;
    expect(bodyText).toContain(otpResponse.code);
  });

  // eslint-disable-next-line no-empty-pattern
  test('email should come from configured sender', async ({}, testInfo) => {
    const testEmail = uniqueEmail('sender-test', testInfo.project.name);

    await sendOtp(testEmail, tenantId);

    const email = await waitForEmailContent(testEmail);
    expect(email).not.toBeNull();
    expect(email!.From.Address).toBe('noreply@localhost');
    expect(email!.From.Name).toBe('SaaS Platform');
  });

  // eslint-disable-next-line no-empty-pattern
  test('multiple OTP emails should arrive independently', async ({}, testInfo) => {
    const suffix = testInfo.project.name.replace(/[^a-z0-9]/gi, '').substring(0, 8);
    const ts = Date.now();
    const email1 = `multi-1-${suffix}-${ts}@example.com`;
    const email2 = `multi-2-${suffix}-${ts}@example.com`;

    await sendOtp(email1, tenantId);
    // TODO: Remove delay once identity API rate limiting is configurable per environment
    // Small delay to avoid rate limiting
    await delay(300);
    await sendOtp(email2, tenantId);

    const msg1 = await waitForEmailContent(email1);
    const msg2 = await waitForEmailContent(email2);

    expect(msg1).not.toBeNull();
    expect(msg2).not.toBeNull();
    expect(msg1!.To[0].Address).toBe(email1);
    expect(msg2!.To[0].Address).toBe(email2);
  });
});

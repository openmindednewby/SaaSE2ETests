import { setTimeout as delay } from 'timers/promises';
import { test, expect } from '@playwright/test';
import axios from 'axios';
import {
  waitForEmailContent,
  isMailpitHealthy,
  clearMailpit,
} from '../../helpers/mailpit.helpers.js';

/**
 * E2E coverage for the /auth/forgot-password + /auth/reset-password flow.
 *
 * Verifies the end-to-end contract that the parallel web auth-client v2
 * relies on:
 *   1. POST /auth/forgot-password ALWAYS returns 200 (no enumeration).
 *   2. A reset email lands in Mailpit when the user exists.
 *   3. The token from the email link redeems via POST /auth/reset-password.
 *   4. The token cannot be redeemed twice.
 *   5. Login works with the new password after reset.
 *
 * Tests are tagged @identity @auth @critical so they run in
 * playwright-e2e-identity-all.
 */

const IDENTITY_API_URL = process.env.IDENTITY_API_URL || 'http://localhost:5002';
const TEST_REALM = process.env.TEST_REALM || 'questioner';
const RESET_URL_TEMPLATE = 'https://app.example.com/reset-password?token={token}';

interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

interface ResetPasswordResponse {
  success: boolean;
  message: string;
}

async function postForgotPassword(email: string, realm: string = TEST_REALM): Promise<{
  status: number;
  data: ForgotPasswordResponse;
}> {
  const response = await axios.post<ForgotPasswordResponse>(
    `${IDENTITY_API_URL}/api/v1/auth/forgot-password`,
    { email, resetUrlTemplate: RESET_URL_TEMPLATE },
    {
      headers: { 'X-Realm': realm },
      timeout: 15000,
      validateStatus: () => true,
    },
  );
  return { status: response.status, data: response.data };
}

async function postResetPassword(
  token: string,
  newPassword: string,
): Promise<{ status: number; data: ResetPasswordResponse }> {
  const response = await axios.post<ResetPasswordResponse>(
    `${IDENTITY_API_URL}/api/v1/auth/reset-password`,
    { token, newPassword },
    {
      timeout: 15000,
      validateStatus: () => true,
    },
  );
  return { status: response.status, data: response.data };
}

/**
 * Pull the reset URL out of the email body, then extract the token from
 * the query string. The token is URL-encoded by the handler so we
 * decode it before returning.
 */
function extractTokenFromEmail(emailBody: string): string {
  const match = emailBody.match(/https:\/\/app\.example\.com\/reset-password\?token=([A-Za-z0-9%_\-.~]+)/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]);
}

test.describe('Password Reset Flow @identity @auth @password-reset', () => {
  test.slow();

  test.beforeAll(async () => {
    const healthy = await isMailpitHealthy();
    test.skip(!healthy, 'Mailpit is not running — skipping password-reset E2E');
  });

  test.beforeEach(async () => {
    // Identity API rate-limits /auth/* at 5 req/min. Spacing keeps tests
    // out of the 429 zone.
    await delay(500);
    await clearMailpit().catch(() => {
      /* idempotent */
    });
  });

  test('forgot-password returns 200 for unknown email (no enumeration)', async () => {
    const ghostEmail = `ghost-${Date.now()}@example.com`;

    const { status, data } = await postForgotPassword(ghostEmail);

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toMatch(/if an account exists/i);
  });

  test('forgot-password sends an email when the user exists', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const userEmail = process.env.TEST_USER_EMAIL;
    if (!username || !userEmail) {
      test.skip(true, 'TEST_USER_EMAIL not configured — skipping happy-path reset test');
      return;
    }

    const { status, data } = await postForgotPassword(userEmail);

    expect(status).toBe(200);
    expect(data.success).toBe(true);

    const email = await waitForEmailContent(userEmail);
    expect(email).not.toBeNull();
    expect(email!.Subject).toMatch(/reset.*password/i);
    expect(email!.To[0].Address).toBe(userEmail);

    const body = email!.HTML || email!.Text;
    expect(body).toMatch(/https:\/\/app\.example\.com\/reset-password\?token=/);
  });

  test('reset-password rejects an unknown token with 400', async () => {
    const { status, data } = await postResetPassword('totally-bogus-token', 'Newpw123!');

    expect(status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/invalid or expired/i);
  });

  test('reset-password rejects a weak password with 400 (validator)', async () => {
    const { status } = await postResetPassword('any-token', 'short');

    expect(status).toBe(400);
  });

  test('full forgot → email → reset → login round-trip @critical', async () => {
    const username = process.env.TEST_USER_USERNAME;
    const userEmail = process.env.TEST_USER_EMAIL;
    const originalPassword = process.env.TEST_USER_PASSWORD;
    if (!username || !userEmail || !originalPassword) {
      test.skip(true, 'TEST_USER_EMAIL/PASSWORD not configured — skipping round-trip test');
      return;
    }

    // Use a unique password we can roll back at the end of the test.
    const tempPassword = `Tmp${Date.now()}Aa!`;

    // 1. Request reset
    const { status: forgotStatus } = await postForgotPassword(userEmail);
    expect(forgotStatus).toBe(200);

    // 2. Pull token from Mailpit
    const email = await waitForEmailContent(userEmail);
    expect(email).not.toBeNull();
    const token = extractTokenFromEmail(email!.HTML || email!.Text);
    expect(token.length).toBeGreaterThan(20);

    // 3. Redeem the token
    const { status: resetStatus, data: resetData } = await postResetPassword(token, tempPassword);
    expect(resetStatus).toBe(200);
    expect(resetData.success).toBe(true);

    // 4. The same token cannot be redeemed again (single-use).
    const { status: replayStatus } = await postResetPassword(token, tempPassword);
    expect(replayStatus).toBe(400);

    // 5. Login with the new password works.
    const loginResponse = await axios.post(
      `${IDENTITY_API_URL}/api/v1/auth/login`,
      {
        method: 0, // UsernamePassword
        username,
        password: tempPassword,
      },
      {
        headers: { 'X-Realm': TEST_REALM },
        timeout: 15000,
        validateStatus: () => true,
      },
    );
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.data.accessToken).toBeTruthy();

    // Roll back: reset to the original password using a fresh token so
    // subsequent tests still work with TEST_USER_PASSWORD.
    await delay(500);
    await postForgotPassword(userEmail);
    const restoreEmail = await waitForEmailContent(userEmail);
    if (restoreEmail) {
      const restoreToken = extractTokenFromEmail(restoreEmail.HTML || restoreEmail.Text);
      await postResetPassword(restoreToken, originalPassword);
    }
  });
});

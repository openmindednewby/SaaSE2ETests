import { test } from '@playwright/test';
import { assertLogoutKillsServerSession } from '../../../helpers/bff-logout-session-death.js';

/**
 * erevna-web — clicking "Log out" must kill the SERVER-side session, not just
 * the client's belief in it.
 *
 * See `helpers/bff-logout-session-death.ts` for the full rationale, including
 * why the obvious "we redirected to /login" assertion passes against the bug
 * and therefore proves nothing.
 */
const EREVNA_BASE_URL = process.env.EREVNA_BASE_URL ?? 'https://staging.erevna.dloizides.com';

test.describe('Logout kills the server session @questioner @bff @security', () => {
  test.slow();

  test('replaying the pre-logout session cookie returns 401 @critical', async ({ browser }) => {
    const username = process.env.TEST_USER_USERNAME;
    const password = process.env.TEST_USER_PASSWORD;
    test.skip(!username || !password, 'TEST_USER_USERNAME / TEST_USER_PASSWORD not configured');

    await assertLogoutKillsServerSession(
      browser,
      { label: 'erevna-web', baseUrl: EREVNA_BASE_URL, cookieName: '__Host-bff-erevna', protectedPath: '/quiz-templates' },
      username as string,
      password as string,
    );
  });
});

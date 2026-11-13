import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  CLIENT_KEY_ENV,
  INTERNAL_TOKEN_ENV,
  assertGatewayReachable,
  clientApiKey,
  internalToken,
  progressState,
} from './modb-session-helpers.js';
import {
  MOCK_CONTROL_TOKEN_ENV,
  firstReviewedWebhook,
  holdReviewedCount,
  screenToAmlTerminal,
} from './modb-reviewed-webhooks.js';

test.describe('#653 session outcome matrix on a PEP match @modb-api', () => {
  test.beforeEach(async ({ request }) => {
    expect(clientApiKey(), `${CLIENT_KEY_ENV} is unset: no session can be created`).toBeTruthy();
    expect(internalToken(), `${INTERNAL_TOKEN_ENV} is unset: no check row can be read`).toBeTruthy();
    expect(process.env[MOCK_CONTROL_TOKEN_ENV], `${MOCK_CONTROL_TOKEN_ENV} is unset: the receiver cannot be read`).toBeTruthy();
    await assertGatewayReachable(request);
  });

  test('AC-653-3 a PEP exact name and DOB completes the session REJECTED FINAL with AML_PEP', async ({ request }) => {
    const subject = 'Nikos Anastasiades';
    const birthDate = '1946-09-27';
    const flowId = 'frontend-v1-active-liveness.mrz-match.aml-screening';
    const expectedStatus = 'COMPLETED';
    const expectedDecision = 'REJECTED';
    const expectedRejectionType = 'FINAL';
    const expectedSessionCode = 'AML_PEP';

    const { session } = await screenToAmlTerminal(request, { subject, birthDate, flowId });

    const { body } = await firstReviewedWebhook(request, session.verificationId);
    expect(body.status).toBe(expectedStatus);
    expect(body.decision).toBe(expectedDecision);
    expect(body.rejection_type).toBe(expectedRejectionType);
    expect(body.reason_codes).toContain(expectedSessionCode);
  });

  test('AC-653-3 a PEP near-name with the same DOB stays in manual review and sends no verificationReviewed', async ({
    request,
  }) => {
    const subject = 'Nicos Anastasiades';
    const birthDate = '1946-09-27';
    const flowId = 'frontend-v1-active-liveness.mrz-match.aml-screening';
    const externalApplicantId = `e2e-modb-${randomUUID()}`;
    const expectedAmlOutcome = 'review';
    const expectedProgress = 'processing';
    const expectedDeliveries = 0;

    const { session, aml } = await screenToAmlTerminal(request, { subject, birthDate, flowId, externalApplicantId });

    expect(aml.outcome).toBe(expectedAmlOutcome);
    expect(await progressState(request, session)).toBe(expectedProgress);
    await holdReviewedCount(request, session.verificationId, expectedDeliveries);
  });
});

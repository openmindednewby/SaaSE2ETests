import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  CLIENT_KEY_ENV,
  INTERNAL_TOKEN_ENV,
  assertGatewayReachable,
  clientApiKey,
  createSession,
  internalToken,
  progressState,
  sessionConfiguration,
} from './modb-session-helpers.js';
import {
  MOCK_CONTROL_TOKEN_ENV,
  firstReviewedWebhook,
  holdReviewedCount,
  screenToAmlTerminal,
} from './modb-reviewed-webhooks.js';

test.describe('Module B session outcome of an AML decision @modb-api', () => {
  test.beforeEach(async ({ request }) => {
    expect(clientApiKey(), `${CLIENT_KEY_ENV} is unset: no session can be created`).toBeTruthy();
    expect(internalToken(), `${INTERNAL_TOKEN_ENV} is unset: no check row can be read`).toBeTruthy();
    expect(process.env[MOCK_CONTROL_TOKEN_ENV], `${MOCK_CONTROL_TOKEN_ENV} is unset: the receiver cannot be read`).toBeTruthy();
    await assertGatewayReachable(request);
  });

  test('AC1 with an AML Fail and later steps never submitted, the session completes REJECTED FINAL', async ({
    request,
  }) => {
    const subject = 'Viktor Anatolijevitch Bout';
    const birthDate = '1967-01-13';
    const flowId = 'frontend-v1-active-liveness.mrz-match.aml-screening';
    const expectedSteps = ['document', 'aml-screening', 'liveness'];
    const expectedAmlOutcome = 'failed';
    const expectedStatus = 'COMPLETED';
    const expectedDecision = 'REJECTED';
    const expectedRejectionType = 'FINAL';
    const expectedProgress = 'complete';

    const { session, aml } = await screenToAmlTerminal(request, { subject, birthDate, flowId });

    const { steps } = await sessionConfiguration(request, session);
    expect(steps).toEqual(expectedSteps);
    expect(aml.outcome).toBe(expectedAmlOutcome);
    const { body } = await firstReviewedWebhook(request, session.verificationId);
    expect(body.status).toBe(expectedStatus);
    expect(body.decision).toBe(expectedDecision);
    expect(body.rejection_type).toBe(expectedRejectionType);
    expect(await progressState(request, session)).toBe(expectedProgress);
  });

  test('AC2 with an AML Fail on a sanctions match, the session reason codes name AML_SANCTIONS', async ({ request }) => {
    const subject = 'Viktor Anatolijevitch Bout';
    const birthDate = '1967-01-13';
    const expectedStoredCategory = 'SANCTIONS';
    const expectedSessionCode = 'AML_SANCTIONS';

    const { session, aml } = await screenToAmlTerminal(request, { subject, birthDate });

    expect(aml.result?.reason_codes).toContain(expectedStoredCategory);
    const { body } = await firstReviewedWebhook(request, session.verificationId);
    expect(body.reason_codes).toContain(expectedSessionCode);
  });

  test('AC4 with an AML Fail, the client receives one signed verificationReviewed carrying the codes', async ({
    request,
  }) => {
    const subject = 'Viktor Anatolijevitch Bout';
    const birthDate = '1967-01-13';
    const expectedDeliveries = 1;
    const expectedSessionCode = 'AML_SANCTIONS';

    const { session } = await screenToAmlTerminal(request, { subject, birthDate });

    const webhook = await firstReviewedWebhook(request, session.verificationId);
    await holdReviewedCount(request, session.verificationId, expectedDeliveries);
    expect(webhook.signatureValid, 'the final webhook must carry a valid HMAC signature').toBe(true);
    expect(webhook.body.session_id).toBe(session.sessionId);
    expect(webhook.body.reason_codes).toContain(expectedSessionCode);
  });

  test('AC7 with an AML Review and a step still open, the applicant shows processing, the session stays PROCESSING undecided, and no verificationReviewed is sent', async ({
    request,
  }) => {
    const subject = 'Vladimir Putin';
    const flowId = 'frontend-v1-active-liveness.mrz-match.aml-screening';
    const externalApplicantId = `e2e-modb-${randomUUID()}`;
    const expectedSteps = ['document', 'aml-screening', 'liveness'];
    const expectedAmlOutcome = 'review';
    const expectedProgress = 'processing';
    const expectedCreationStatus = 'REUSED';
    const expectedSessionStatus = 'PROCESSING';
    const expectedDeliveries = 0;

    const { session, aml } = await screenToAmlTerminal(request, { subject, flowId, externalApplicantId });

    const { steps } = await sessionConfiguration(request, session);
    expect(steps).toEqual(expectedSteps);
    expect(aml.outcome).toBe(expectedAmlOutcome);
    expect(await progressState(request, session)).toBe(expectedProgress);
    const reused = await createSession(request, flowId, externalApplicantId);
    expect(reused.sessionId, 'a session holding a decision is never reused, so another id means it was decided').toBe(
      session.sessionId,
    );
    expect(reused.creationStatus).toBe(expectedCreationStatus);
    expect(reused.status).toBe(expectedSessionStatus);
    await holdReviewedCount(request, session.verificationId, expectedDeliveries);
  });
});

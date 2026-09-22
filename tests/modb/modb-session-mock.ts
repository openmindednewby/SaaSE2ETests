// MODB-E2E-MIGRATE-1 "Migrate the modb-api suite to the session API" - one screened verification, driven through
// the session flow the deployed gateway actually registers.
//
// The acceptance specs used to submit every check in one `POST /api/v1/verifications`. That route is unregistered
// upstream (404, cause `726f2b1`, MODB-ENDPOINT-1), so a screening now means: create a buyer session on a flow that
// contains `document` + `aml-screening`, submit the document step, and poll the session's check rows. The per-step
// mock controls (`mock_outcomes`, `mock_identity`) landed with gateway `8574303` behind
// VERIFICATION_MOCK_OUTCOMES_ENABLED (true on staging) and are the only way to steer the mock per verification.
import { randomUUID } from 'node:crypto';
import { type APIRequestContext } from '@playwright/test';
import { mockIdentityFields } from './modb-demo-identity.js';
import {
  MINIMAL_AML_FLOW,
  createSession,
  submitDocument,
  type MockOutcome,
  type SessionHandle,
} from './modb-session-helpers.js';

export interface ScreenRequest {
  /** The name the MRZ mock returns, and therefore the name AML screens. Omitted = the ERIKSSON specimen. */
  subject?: string;
  /** Forced outcomes for the checks of this step; the document step runs `mrz_match`. */
  mockOutcomes?: Partial<Record<string, MockOutcome>>;
  flowId?: string;
  documentType?: string;
}

export interface ScreenedSubmission {
  session: SessionHandle;
  /** The gateway request id of the document step: the id `/checks/{id}` and `/checks/{id}/aml-case` are keyed on. */
  requestId: string;
}

/** Creates a session, submits its document step with the given mock controls, and returns the session + request id. */
export async function screenViaSession(
  request: APIRequestContext,
  { subject, mockOutcomes = { mrz_match: 'passed' }, flowId = MINIMAL_AML_FLOW, documentType }: ScreenRequest = {},
): Promise<ScreenedSubmission> {
  const session = await createSession(request, flowId, `e2e-modb-${randomUUID()}`);
  const requestId = await submitDocument(request, session, {
    mockOutcomes,
    documentType,
    extraFields: subject ? mockIdentityFields(subject) : {},
  });
  return { session, requestId };
}

// @modb-api tier — MODB-MOCK-1 "demo identity picker + AML source links", acceptance tests AC-MOCK-2, AC-MOCK-3,
// AC-MOCK-5 and the API side of AC-MOCK-12 (owner decision MOCK-1-D4, MODB-MOCK-1-SPEC.md §4). HTTP only, against the
// wl-api-gateway (MODB_GATEWAY_URL) and, for the screened name, AMLService's own case record (MODB_AML_URL + key).
//
// Committed RED before implementation: the gateway rejects the unknown `mock_identity` form field
// (ValidationPipe forbidNonWhitelisted), so AC-MOCK-3 fails at submit. AC-MOCK-2 and AC-MOCK-5 need the frontend's
// demo-identities.json and report a skip naming its path until it exists. AC-MOCK-12 is a guard on today's
// behaviour and is expected green throughout.
//
// UI-owned, NOT here: AC-MOCK-1, 7, 9, 13 and the UI side of 8, 10, 11, 12 (portal unit tests + visual-qa).
//
// MODB-E2E-MIGRATE-1 (2026-09-23): the transport moved to the SESSION API - a buyer session on
// `frontend-v1-passive-mrz-match.aml-screening`, then the document step carrying `mock_identity` and
// `mock_outcomes` (gateway `8574303`). `POST /api/v1/verifications` is unregistered upstream (MODB-ENDPOINT-1).
// What each AC asserts is unchanged: the name AML screened is read from AMLService's own case record.
import { expect, test } from '@playwright/test';
import {
  AML_CHECK,
  amlCase,
  assertGatewayReachable,
  rowOf,
  waitForAmlTerminal,
} from './modb-session-helpers.js';
import { screenViaSession } from './modb-session-mock.js';
import {
  SPECIMEN_TOKENS,
  fixtureAbsentReason,
  loadDemoIdentities,
  nameTokens,
  screenedName,
  screeningIdOf,
} from './modb-demo-identity.js';

/** A synthetic free-text subject: no watchlist holds it, and it is not one of the samples. */
const FREE_TEXT_NAME = 'Quillon Vantablack Testsubject';

test.describe('MODB-MOCK-1 demo identity reaches the AML screening @modb-api', () => {
  test('AC-MOCK-2: a chosen sample identity is the name AML screened, read from the screening record', async ({ request }) => {
    const identities = loadDemoIdentities();
    test.skip(identities === null, fixtureAbsentReason());
    const identity = (identities ?? [])[0];
    expect(identity, 'demo-identities.json holds no identity').toBeDefined();
    await assertGatewayReachable(request);

    const { session, requestId } = await screenViaSession(request, { subject: identity.name });
    test.info().annotations.push({
      type: 'request_id',
      description: `${requestId} session=${session.sessionId} sample=${identity.label}`,
    });
    expect(rowOf(await waitForAmlTerminal(request, session.sessionId), AML_CHECK).status).toBe('completed');

    const screened = await screenedName(request, await screeningIdOf(request, requestId));
    expect(nameTokens(screened), `screened "${screened}"`).toEqual(nameTokens(identity.name));
    expect(nameTokens(screened)).not.toEqual(SPECIMEN_TOKENS);
  });

  test('AC-MOCK-3: free text is screened as typed, with no sample identity applied', async ({ request }) => {
    await assertGatewayReachable(request);

    const { session, requestId } = await screenViaSession(request, { subject: FREE_TEXT_NAME });
    test.info().annotations.push({ type: 'request_id', description: `${requestId} session=${session.sessionId}` });
    expect(rowOf(await waitForAmlTerminal(request, session.sessionId), AML_CHECK).status).toBe('completed');

    const screened = nameTokens(await screenedName(request, await screeningIdOf(request, requestId)));
    expect(screened).toEqual(nameTokens(FREE_TEXT_NAME));
    expect(screened).not.toEqual(SPECIMEN_TOKENS);
    const sampleTokens = (loadDemoIdentities() ?? []).map((identity) => nameTokens(identity.name).join(' '));
    expect(sampleTokens).not.toContain(screened.join(' '));
  });

  test('AC-MOCK-5: the sample labelled criminal screens to a criminal classification', async ({ request }) => {
    const identities = loadDemoIdentities();
    test.skip(identities === null, fixtureAbsentReason());
    // A present fixture with no criminal sample fails: the demo promises one.
    const criminal = (identities ?? []).find((identity) => identity.classification.toLowerCase() === 'criminal');
    expect(criminal, 'demo-identities.json has no entry with classification "criminal"').toBeDefined();
    await assertGatewayReachable(request);

    const identity = criminal as NonNullable<typeof criminal>;
    const { session, requestId } = await screenViaSession(request, { subject: identity.name });
    test.info().annotations.push({
      type: 'request_id',
      description: `${requestId} session=${session.sessionId} recorded=${identity.screeningId}@${identity.verifiedAt}`,
    });
    expect(rowOf(await waitForAmlTerminal(request, session.sessionId), AML_CHECK).status).toBe('completed');

    const read = await amlCase(request, requestId);
    expect(read.status(), await read.text()).toBe(200);
    // Red here with a changed classification means the label has EXPIRED (spec §4 NOT COVERED), not a flake.
    expect(String((await read.json()).data.classification).toLowerCase(), `label "${identity.label}"`).toBe('criminal');
  });

  test('AC-MOCK-12 (API side): without a demo identity the MRZ-derived specimen name is screened, as today', async ({ request }) => {
    await assertGatewayReachable(request);

    const { session, requestId } = await screenViaSession(request);
    test.info().annotations.push({ type: 'request_id', description: `${requestId} session=${session.sessionId}` });
    expect(rowOf(await waitForAmlTerminal(request, session.sessionId), AML_CHECK).status).toBe('completed');

    const screened = await screenedName(request, await screeningIdOf(request, requestId));
    expect(nameTokens(screened), `screened "${screened}"`).toEqual(SPECIMEN_TOKENS);
  });
});

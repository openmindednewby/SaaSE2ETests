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
import { expect, test } from '@playwright/test';
import { AML_CHECK, MRZ_CHECK, assertGatewayReachable, getAmlCase, rowOf, submitVerification, waitForAmlTerminal } from './modb-helpers.js';
import {
  SPECIMEN_TOKENS,
  fixtureAbsentReason,
  loadDemoIdentities,
  mockIdentityFields,
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

    const requestId = await submitVerification(request, { mrz_match: 'passed' }, [MRZ_CHECK], mockIdentityFields(identity.name));
    test.info().annotations.push({ type: 'request_id', description: `${requestId} sample=${identity.label}` });
    expect(rowOf(await waitForAmlTerminal(request, requestId), AML_CHECK).status).toBe('completed');

    const screened = await screenedName(request, await screeningIdOf(request, requestId));
    expect(nameTokens(screened), `screened "${screened}"`).toEqual(nameTokens(identity.name));
    expect(nameTokens(screened)).not.toEqual(SPECIMEN_TOKENS);
  });

  test('AC-MOCK-3: free text is screened as typed, with no sample identity applied', async ({ request }) => {
    await assertGatewayReachable(request);

    const requestId = await submitVerification(request, { mrz_match: 'passed' }, [MRZ_CHECK], mockIdentityFields(FREE_TEXT_NAME));
    test.info().annotations.push({ type: 'request_id', description: requestId });
    expect(rowOf(await waitForAmlTerminal(request, requestId), AML_CHECK).status).toBe('completed');

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
    const requestId = await submitVerification(request, { mrz_match: 'passed' }, [MRZ_CHECK], mockIdentityFields(identity.name));
    test.info().annotations.push({ type: 'request_id', description: `${requestId} recorded=${identity.screeningId}@${identity.verifiedAt}` });
    expect(rowOf(await waitForAmlTerminal(request, requestId), AML_CHECK).status).toBe('completed');

    const amlCase = await getAmlCase(request, requestId);
    expect(amlCase.status()).toBe(200);
    // Red here with a changed classification means the label has EXPIRED (spec §4 NOT COVERED), not a flake.
    expect(String((await amlCase.json()).data.classification).toLowerCase(), `label "${identity.label}"`).toBe('criminal');
  });

  test('AC-MOCK-12 (API side): without a demo identity the MRZ-derived specimen name is screened, as today', async ({ request }) => {
    await assertGatewayReachable(request);

    const requestId = await submitVerification(request, { mrz_match: 'passed' });
    test.info().annotations.push({ type: 'request_id', description: requestId });
    expect(rowOf(await waitForAmlTerminal(request, requestId), AML_CHECK).status).toBe('completed');

    const screened = await screenedName(request, await screeningIdOf(request, requestId));
    expect(nameTokens(screened), `screened "${screened}"`).toEqual(SPECIMEN_TOKENS);
  });
});

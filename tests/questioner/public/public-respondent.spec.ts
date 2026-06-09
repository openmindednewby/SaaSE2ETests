import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getProjectUsers } from '../../../fixtures/test-data.js';
import { createQuestionerApiHelper, QuestionerApiHelper } from '../../../helpers/questioner-admin.js';
import {
  createAnonymousQuestionerContext,
  getPublicTemplate,
  submitPublicResponse,
  type PublicQuestionerContents,
} from '../../../helpers/questioner/publicRespondent.js';

/**
 * E2E — Erevna PUBLIC / ANONYMOUS survey-respondent flow @questioner
 *
 * Proves the respondent-facing questioner-api endpoints (NOT behind the BFF,
 * called direct to the questioner API host root at `/public/...`):
 *
 *   GET  /public/questionerTemplates/{externalId}
 *   POST /public/questionerTemplates/{externalId}/responses
 *
 * Flow:
 *   1. OWNER (questioner-realm ROPC) creates a template with a correct `answer`
 *      set on one question + a required question, then ACTIVATES it.
 *   2. ANONYMOUS client (no auth, no cookies) reads the public view — asserts
 *      the questions/options are present AND no correct answer leaks — then
 *      submits a valid answer set and gets back an externalId.
 *   3. OWNER asserts the submitted response shows up in their answers list.
 *   4. Anonymous GET of a deactivated template → 404; of a random guid → 404.
 *   5. Owner teardown deletes the template + the submitted response.
 *
 * Pure API — no UI. The OWNER half reuses `QuestionerApiHelper`; the ANONYMOUS
 * half uses a fresh Playwright APIRequestContext bound to QUESTIONER_API_URL.
 */

// Questioner question types (mirror Questioner.Core QuestionType).
const QUESTION_TYPE_TEXT = 0;
const QUESTION_TYPE_RADIO = 3;

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

// A guid that will never resolve to a real template.
const NONEXISTENT_GUID = '00000000-0000-0000-0000-000000000000';

const Q_RATING = 'q-rating';
const Q_NAME = 'q-name';
const RATING_CORRECT_VALUE = 'excellent';

/** Template contents WITH a correct answer set on the rating question. */
function buildOwnerContents(): PublicQuestionerContents {
  return {
    questions: [
      {
        id: Q_RATING,
        name: 'Overall Rating',
        type: QUESTION_TYPE_RADIO,
        options: [
          { label: 'Excellent', value: 'excellent' },
          { label: 'Good', value: 'good' },
          { label: 'Poor', value: 'poor' },
        ],
        page: 1,
        order: 1,
        isRequired: true,
        // Correct answer — MUST be stripped from the public respondent view.
        answer: { stringValue: RATING_CORRECT_VALUE },
      },
      {
        id: Q_NAME,
        name: 'Your Name',
        type: QUESTION_TYPE_TEXT,
        page: 1,
        order: 2,
        isRequired: true,
      },
    ],
  };
}

/** A valid respondent answer set for the public template. */
function buildRespondentContents(): PublicQuestionerContents {
  return {
    questions: [
      {
        id: Q_RATING,
        name: 'Overall Rating',
        type: QUESTION_TYPE_RADIO,
        page: 1,
        order: 1,
        isRequired: true,
        answer: { stringValue: 'good' },
      },
      {
        id: Q_NAME,
        name: 'Your Name',
        type: QUESTION_TYPE_TEXT,
        page: 1,
        order: 2,
        isRequired: true,
        answer: { stringValue: 'Anonymous Respondent' },
      },
    ],
  };
}

test.describe.serial('Public Respondent Flow @questioner', () => {
  let owner: QuestionerApiHelper;
  let anon: APIRequestContext;
  let activeTemplateId: string | null = null;
  let inactiveTemplateId: string | null = null;
  let submittedResponseId: string | null = null;
  const templateName = `Public Respondent E2E ${Date.now()}`;

  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    const { admin } = getProjectUsers(testInfo.project.name);

    // OWNER: ROPC into the questioner realm (KI-5 cross-realm wall).
    owner = createQuestionerApiHelper();
    await owner.login(admin.username, admin.password);

    // Only one active template is allowed per tenant — clear any leftovers.
    await owner.deactivateAllTemplates();

    // Create + populate (with a correct answer set) + activate in one update.
    activeTemplateId = await owner.createTemplate(templateName, 'E2E public respondent template');
    await owner.updateTemplate(
      activeTemplateId,
      templateName,
      'E2E public respondent template',
      buildOwnerContents(),
      true,
    );

    anon = await createAnonymousQuestionerContext();
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(60_000);
    await anon?.dispose().catch(() => {});
    if (owner) {
      const answerIds = submittedResponseId ? [submittedResponseId] : [];
      await owner.cleanup(activeTemplateId, answerIds).catch(() => {});
      if (inactiveTemplateId) {
        await owner.deleteTemplate(inactiveTemplateId).catch(() => {});
      }
    }
  });

  test('anonymous GET returns the public template without leaking correct answers', async () => {
    expect(activeTemplateId, 'owner setup must have produced a template externalId').toBeTruthy();

    const result = await getPublicTemplate(anon, activeTemplateId as string);
    expect(result.status, `expected 200 for active template, body: ${result.rawText}`).toBe(HTTP_OK);

    const payload = result.body;
    expect(payload, 'public GET must return a JSON body').not.toBeNull();
    expect(payload?.externalId).toBe(activeTemplateId);

    const questions = payload?.contents?.questions ?? [];
    expect(questions.length, 'public template must expose its questions').toBeGreaterThan(0);

    // Options must survive for choice questions so the respondent can answer.
    const rating = questions.find((q) => q.id === Q_RATING);
    expect(rating, 'rating question must be present').toBeTruthy();
    expect(rating?.options?.length ?? 0, 'rating options must be exposed').toBeGreaterThan(0);

    // CRITICAL: no correct answer may leak to an anonymous respondent.
    for (const q of questions) {
      const answer = q.answer;
      const hasLeak =
        answer != null &&
        (answer.stringValue != null ||
          answer.boolValue != null ||
          answer.numericValue != null ||
          (answer.multiValues != null && answer.multiValues.length > 0));
      expect(
        hasLeak,
        `correct answer leaked on question "${q.id}": ${JSON.stringify(answer)}`,
      ).toBe(false);
    }
  });

  test('anonymous POST submits a response and returns an externalId', async () => {
    expect(activeTemplateId).toBeTruthy();

    const result = await submitPublicResponse(anon, activeTemplateId as string, {
      name: 'Anonymous Respondent',
      description: 'Submitted via public E2E',
      contents: buildRespondentContents(),
    });

    expect(result.status, `expected 200 on submit, body: ${result.rawText}`).toBe(HTTP_OK);
    expect(result.body?.externalId, 'submit must return an externalId').toBeTruthy();
    submittedResponseId = result.body?.externalId ?? null;
  });

  test('owner sees the anonymously-submitted response in their answers list', async () => {
    expect(submittedResponseId, 'a response must have been submitted first').toBeTruthy();

    const completed = await owner.listCompletedQuestioners();
    const match = completed.find((c) => c.externalId === submittedResponseId);
    expect(
      match,
      `submitted response ${submittedResponseId} must appear in the owner answers list`,
    ).toBeTruthy();
    expect(match?.questionerTemplateExternalId).toBe(activeTemplateId);
  });

  test('anonymous GET of a deactivated template returns 404', async () => {
    // Create a second template, leave it INACTIVE, and confirm the public view 404s.
    inactiveTemplateId = await owner.createTemplate(
      `${templateName} (inactive)`,
      'E2E inactive template',
    );
    await owner.updateTemplate(
      inactiveTemplateId,
      `${templateName} (inactive)`,
      'E2E inactive template',
      buildOwnerContents(),
      false,
    );

    const result = await getPublicTemplate(anon, inactiveTemplateId);
    expect(
      result.status,
      `inactive template public GET must be 404, body: ${result.rawText}`,
    ).toBe(HTTP_NOT_FOUND);
  });

  test('anonymous GET of a nonexistent template returns 404', async () => {
    const result = await getPublicTemplate(anon, NONEXISTENT_GUID);
    expect(
      result.status,
      `nonexistent template public GET must be 404, body: ${result.rawText}`,
    ).toBe(HTTP_NOT_FOUND);
  });
});

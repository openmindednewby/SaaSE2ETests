/**
 * Gate B golden path — Erevna (surveys): a respondent answers a survey end-to-end.
 *
 * Gate B (`prod-login-gate.spec.ts`) only proves "login renders the dashboard" —
 * it catches a crash, not UX-level breakage of the product's CORE flow. This
 * adds the erevna golden path so a broken respondent path fails the gate loudly:
 * an OWNER creates + activates a survey template, an ANONYMOUS respondent reads
 * the public view and submits an answer set, and the owner sees the response land
 * in their answers list. If any link in that chain breaks (public GET 404/500,
 * submit rejected, response not recorded), the gate fails.
 *
 * This is the gate-sized distillation of the full `questioner/public/
 * public-respondent.spec.ts` suite — same helpers, one end-to-end assertion, plus
 * its own teardown. Pure `@api` (no UI): the respondent-facing questioner-api
 * endpoints sit at the host root (`/api/v1/public/...`), not behind the BFF.
 *
 * Creds: it needs QUESTIONER-REALM owner creds (questioner-api enforces a
 * cross-realm wall — the onlinemenu-realm superUser is rejected 401). Like the
 * erevna row in `prod-login-gate.spec.ts`, it self-skips until
 * EREVNA_TEST_USERNAME/PASSWORD are wired for the target, then gates
 * automatically. Runnable now against a local/staging erevna stack by pointing
 * those vars at a seeded questioner-realm user.
 *
 * Run: `E2E_TARGET=<target> npx playwright test --project=prod-gate`.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

import { createQuestionerApiHelper, type QuestionerApiHelper } from '../../helpers/questioner-admin.js';
import {
  createAnonymousQuestionerContext,
  getPublicTemplate,
  submitPublicResponse,
  type PublicQuestionerContents,
} from '../../helpers/questioner/publicRespondent.js';

// Questioner question types (mirror Questioner.Core QuestionType).
const QUESTION_TYPE_TEXT = 0;
const QUESTION_TYPE_RADIO = 3;
const HTTP_OK = 200;
const GATE_TIMEOUT = 120_000;

const Q_RATING = 'q-rating';
const Q_NAME = 'q-name';

const questionerApiUrl = process.env.QUESTIONER_API_URL;
const ownerUsername = process.env.EREVNA_TEST_USERNAME;
const ownerPassword = process.env.EREVNA_TEST_PASSWORD;

/** Owner-authored contents WITH a correct answer set (stripped from the public view). */
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
        answer: { stringValue: 'excellent' },
      },
      { id: Q_NAME, name: 'Your Name', type: QUESTION_TYPE_TEXT, page: 1, order: 2, isRequired: true },
    ],
  };
}

/** A valid respondent answer set. */
function buildRespondentContents(): PublicQuestionerContents {
  return {
    questions: [
      { id: Q_RATING, name: 'Overall Rating', type: QUESTION_TYPE_RADIO, page: 1, order: 1, isRequired: true, answer: { stringValue: 'good' } },
      { id: Q_NAME, name: 'Your Name', type: QUESTION_TYPE_TEXT, page: 1, order: 2, isRequired: true, answer: { stringValue: 'Gate Respondent' } },
    ],
  };
}

test('prod-gate: erevna respondent answers a survey end-to-end @api @critical', async () => {
  test.skip(
    !questionerApiUrl || !ownerUsername || !ownerPassword,
    'erevna golden path needs questioner-realm creds — set QUESTIONER_API_URL + EREVNA_TEST_USERNAME/PASSWORD for this target',
  );
  test.setTimeout(GATE_TIMEOUT);

  const owner: QuestionerApiHelper = createQuestionerApiHelper();
  await owner.login(ownerUsername!, ownerPassword!);
  // Only one active template per tenant — clear leftovers before seeding.
  await owner.deactivateAllTemplates();

  const name = `Gate Survey ${Date.now()}`;
  const templateId = await owner.createTemplate(name, 'prod-gate golden path');
  await owner.updateTemplate(templateId, name, 'prod-gate golden path', buildOwnerContents(), true);

  let anon: APIRequestContext | null = null;
  let responseId: string | null = null;
  try {
    anon = await createAnonymousQuestionerContext();

    // 1. Anonymous respondent reads the public, answer-stripped view.
    const publicView = await getPublicTemplate(anon, templateId);
    expect(publicView.status, `public GET status, body: ${publicView.rawText}`).toBe(HTTP_OK);
    expect(publicView.body?.externalId).toBe(templateId);
    expect((publicView.body?.contents?.questions ?? []).length, 'public view exposes questions').toBeGreaterThan(0);

    // 2. Anonymous respondent submits a valid answer set.
    const submit = await submitPublicResponse(anon, templateId, {
      name: 'Gate Respondent',
      description: 'prod-gate golden path',
      contents: buildRespondentContents(),
    });
    expect(submit.status, `public submit status, body: ${submit.rawText}`).toBe(HTTP_OK);
    responseId = submit.body?.externalId ?? null;
    expect(responseId, 'submit must return an externalId').toBeTruthy();

    // 3. The response is recorded — the owner sees it in their answers list.
    const completed = await owner.listCompletedQuestioners();
    const match = completed.find((c) => c.externalId === responseId);
    expect(match, `submitted response ${String(responseId)} must appear in the owner answers list`).toBeTruthy();
    expect(match?.questionerTemplateExternalId).toBe(templateId);
  } finally {
    await anon?.dispose().catch(() => {});
    await owner.cleanup(templateId, responseId ? [responseId] : []).catch(() => {});
  }
});

import https from 'https';

import axios, { type AxiosInstance } from 'axios';

import { AuthHelper } from './auth-helper.js';

/**
 * HTTPS agent that ignores self-signed certificate errors.
 * The Questioner API uses HTTPS with a dev certificate in Docker.
 */
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Shape of a question in the Questioner API.
 * Maps to Questioner.Core.QuestionerAggregate.Question.
 */
interface QuestionOption {
  label: string;
  value: string;
}

interface QuestionAnswer {
  boolValue?: boolean | null;
  stringValue?: string | null;
  numericValue?: number | null;
  multiValues?: string[] | null;
}

interface Question {
  id: string;
  name: string;
  type: QuestionType;
  options?: QuestionOption[] | null;
  page: number;
  answer?: QuestionAnswer | null;
  isRequired: boolean;
  skipConditions?: null;
  order: number;
}

const enum QuestionType {
  Text = 0,
  MultipleChoice = 1,
  Checkbox = 2,
  Radio = 3,
  Dropdown = 4,
}

interface QuestionerContents {
  questions: Question[];
}

interface TemplateDto {
  externalId: string;
  name: string;
  description: string | null;
  contents: QuestionerContents;
  contentsJson: string;
  isActive: boolean;
  createdDate: string;
  lastUpdatedDate: string;
}

interface ListTemplatesResponse {
  questionerTemplates: TemplateDto[];
}

interface CreateTemplateResponse {
  externalId: string;
}

interface CompletedQuestionerDto {
  externalId: string;
  userId: string;
  name: string;
  description: string | null;
  contents: QuestionerContents;
  contentsJson: string;
  questionerTemplateExternalId: string;
  createdDate: string;
  lastUpdatedDate: string;
}

interface ListCompletedResponse {
  completedQuestioners: CompletedQuestionerDto[];
}

interface CreateCompletedResponse {
  externalId: string;
}

function normalizeApiBase(apiUrl: string): string {
  if (apiUrl.endsWith('/api/v1/')) return apiUrl;
  if (apiUrl.endsWith('/api/v1')) return `${apiUrl}/`;
  return `${apiUrl}/api/v1/`;
}

function createQuestionerClient(apiUrl: string, accessToken: string): AxiosInstance {
  const baseURL = normalizeApiBase(apiUrl);
  const useHttps = baseURL.startsWith('https');
  return axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    ...(useHttps ? { httpsAgent } : {}),
  });
}

/**
 * Helper for managing Questioner API data in E2E tests.
 * Allows creating templates with questions, activating them, and submitting answers
 * via direct API calls (bypassing the UI) for fast test data setup.
 */
export class QuestionerApiHelper {
  private client: AxiosInstance;

  constructor(
    private readonly questionerApiUrl: string,
    private readonly identityApiUrl: string,
  ) {
    // Client is initialized lazily after login
    this.client = null as unknown as AxiosInstance;
  }

  /**
   * Authenticate and initialize the API client.
   * Must be called before any other method.
   */
  async login(username: string, password: string): Promise<void> {
    const auth = new AuthHelper(this.identityApiUrl);
    await auth.loginViaAPI(username, password);
    const token = auth.getAccessToken();
    if (!token) {
      throw new Error('QuestionerApiHelper: failed to acquire access token');
    }
    this.client = createQuestionerClient(this.questionerApiUrl, token);
  }

  /**
   * List all questioner templates for the current tenant.
   */
  async listTemplates(): Promise<TemplateDto[]> {
    const resp = await this.client.get('questionerTemplates/list');
    const data = resp.data as ListTemplatesResponse;
    return data.questionerTemplates ?? [];
  }

  /**
   * Get the currently active template, or null if none.
   */
  async getActiveTemplate(): Promise<TemplateDto | null> {
    try {
      const resp = await this.client.get('questionerTemplates/active');
      return resp.data as TemplateDto;
    } catch (e: any) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  }

  /**
   * Create a new template and return its externalId.
   */
  async createTemplate(name: string, description?: string): Promise<string> {
    const resp = await this.client.post('questionerTemplates', {
      name,
      description: description ?? null,
    });
    const data = resp.data as CreateTemplateResponse;
    return data.externalId;
  }

  /**
   * Update a template (name, description, contents, and active status).
   */
  async updateTemplate(
    externalId: string,
    name: string,
    description: string | null,
    contents: QuestionerContents,
    isActive: boolean,
  ): Promise<void> {
    await this.client.put(`questionerTemplates/${externalId}`, {
      externalId,
      name,
      description,
      contents,
      isActive,
    });
  }

  /**
   * Activate or deactivate a template.
   */
  async activateTemplate(externalId: string, isActive: boolean): Promise<void> {
    await this.client.put(`questionerTemplates/ActivateTemplate/${externalId}`, {
      externalId,
      isActive,
    });
  }

  /**
   * Delete a template by externalId.
   */
  async deleteTemplate(externalId: string): Promise<void> {
    try {
      await this.client.delete(`questionerTemplates/${externalId}`);
    } catch (e: any) {
      // 404 means already deleted — that is fine
      if (e?.response?.status !== 404) throw e;
    }
  }

  /**
   * Deactivate all active templates for the current tenant.
   */
  async deactivateAllTemplates(): Promise<void> {
    const templates = await this.listTemplates();
    for (const t of templates) {
      if (t.isActive) {
        await this.activateTemplate(t.externalId, false);
      }
    }
  }

  /**
   * Create a multi-page template with text and radio questions, activate it,
   * and return the template details.
   *
   * Page 1: 2 text questions (required) + 1 radio question
   * Page 2: 2 text questions (required) + 1 radio question
   */
  async createAndActivateMultiPageTemplate(namePrefix: string): Promise<{
    externalId: string;
    name: string;
    contents: QuestionerContents;
  }> {
    // Deactivate any existing active template first
    await this.deactivateAllTemplates();

    const name = `${namePrefix} ${Date.now()}`;
    const externalId = await this.createTemplate(name, 'E2E multi-page test template');

    const contents: QuestionerContents = {
      questions: [
        // Page 1
        {
          id: 'q1-text-name',
          name: 'Your Name',
          type: QuestionType.Text,
          page: 1,
          order: 1,
          isRequired: true,
        },
        {
          id: 'q1-text-email',
          name: 'Your Email',
          type: QuestionType.Text,
          page: 1,
          order: 2,
          isRequired: true,
        },
        {
          id: 'q1-radio-rating',
          name: 'Overall Rating',
          type: QuestionType.Radio,
          options: [
            { label: 'Excellent', value: 'excellent' },
            { label: 'Good', value: 'good' },
            { label: 'Average', value: 'average' },
            { label: 'Poor', value: 'poor' },
          ],
          page: 1,
          order: 3,
          isRequired: true,
        },
        // Page 2
        {
          id: 'q2-text-feedback',
          name: 'Feedback Comments',
          type: QuestionType.Text,
          page: 2,
          order: 1,
          isRequired: true,
        },
        {
          id: 'q2-text-suggestion',
          name: 'Improvement Suggestions',
          type: QuestionType.Text,
          page: 2,
          order: 2,
          isRequired: false,
        },
        {
          id: 'q2-radio-recommend',
          name: 'Would You Recommend Us',
          type: QuestionType.Radio,
          options: [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
            { label: 'Maybe', value: 'maybe' },
          ],
          page: 2,
          order: 3,
          isRequired: true,
        },
      ],
    };

    // Update the template with the questions and activate it in one call
    await this.updateTemplate(externalId, name, 'E2E multi-page test template', contents, true);

    return { externalId, name, contents };
  }

  /**
   * List all completed questioners for the current tenant.
   */
  async listCompletedQuestioners(): Promise<CompletedQuestionerDto[]> {
    const resp = await this.client.get('completedQuestioners/list');
    const data = resp.data as ListCompletedResponse;
    return data.completedQuestioners ?? [];
  }

  /**
   * Submit a completed questioner (quiz answer) via the API.
   */
  async submitQuizAnswer(
    templateExternalId: string,
    name: string,
    description: string | null,
    contents: QuestionerContents,
  ): Promise<string> {
    const resp = await this.client.post('completedQuestioners', {
      name,
      description,
      questionerTemplateExternalId: templateExternalId,
      contents,
    });
    const data = resp.data as CreateCompletedResponse;
    return data.externalId;
  }

  /**
   * Delete a completed questioner by externalId.
   */
  async deleteCompletedQuestioner(externalId: string): Promise<void> {
    try {
      await this.client.delete(`completedQuestioners/${externalId}`);
    } catch (e: any) {
      if (e?.response?.status !== 404) throw e;
    }
  }

  /**
   * Create a multi-page template, activate it, and submit several quiz answers.
   * Returns the template and answer IDs for cleanup.
   */
  async setupMultiPageTemplateWithAnswers(namePrefix: string): Promise<{
    templateExternalId: string;
    templateName: string;
    contents: QuestionerContents;
    answerExternalIds: string[];
  }> {
    const template = await this.createAndActivateMultiPageTemplate(namePrefix);

    // Create filled-in contents for answers
    const answerExternalIds: string[] = [];
    const answerDataSets = [
      { name: 'Alice Johnson', email: 'alice@test.com', feedback: 'Great service', rating: 'excellent', recommend: 'yes' },
      { name: 'Bob Smith', email: 'bob@test.com', feedback: 'Good experience', rating: 'good', recommend: 'maybe' },
      { name: 'Carol Davis', email: 'carol@test.com', feedback: 'Needs improvement', rating: 'average', recommend: 'no' },
    ];

    for (const data of answerDataSets) {
      const answeredContents: QuestionerContents = {
        questions: template.contents.questions.map((q) => {
          const answered = { ...q, answer: null as QuestionAnswer | null };
          switch (q.id) {
            case 'q1-text-name':
              answered.answer = { stringValue: data.name };
              break;
            case 'q1-text-email':
              answered.answer = { stringValue: data.email };
              break;
            case 'q1-radio-rating':
              answered.answer = { stringValue: data.rating };
              break;
            case 'q2-text-feedback':
              answered.answer = { stringValue: data.feedback };
              break;
            case 'q2-text-suggestion':
              answered.answer = { stringValue: 'No suggestions' };
              break;
            case 'q2-radio-recommend':
              answered.answer = { stringValue: data.recommend };
              break;
          }
          return answered;
        }),
      };

      const answerId = await this.submitQuizAnswer(
        template.externalId,
        `Answer from ${data.name}`,
        `Test answer submitted by ${data.name}`,
        answeredContents,
      );
      answerExternalIds.push(answerId);
    }

    return {
      templateExternalId: template.externalId,
      templateName: template.name,
      contents: template.contents,
      answerExternalIds,
    };
  }

  /**
   * Clean up: deactivate template, delete answers, delete template.
   */
  async cleanup(templateExternalId: string | null, answerExternalIds: string[]): Promise<void> {
    // Delete answers first
    for (const id of answerExternalIds) {
      await this.deleteCompletedQuestioner(id).catch(() => {});
    }

    if (templateExternalId) {
      // Deactivate before deleting
      await this.activateTemplate(templateExternalId, false).catch(() => {});
      await this.deleteTemplate(templateExternalId).catch(() => {});
    }
  }
}

/**
 * Create a QuestionerApiHelper using environment variables for URLs.
 */
/**
 * Create a QuestionerApiHelper using environment variables for URLs.
 * Falls back to https://localhost:5004 for the Questioner API (it uses HTTPS in Docker).
 */
export function createQuestionerApiHelper(): QuestionerApiHelper {
  const questionerUrl = process.env.QUESTIONER_API_URL || 'https://localhost:5004';
  const identityUrl = process.env.IDENTITY_API_URL || 'http://localhost:5002';
  return new QuestionerApiHelper(questionerUrl, identityUrl);
}

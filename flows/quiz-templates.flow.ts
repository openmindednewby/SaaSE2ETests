import { QuizTemplatesPage } from '../pages/QuizTemplatesPage.js';
import { QuizTemplatesQuizPage } from '../pages/QuizTemplatesQuizPage.js';

/**
 * Create a template and verify it appears in the list.
 */
export async function createTemplateAndWait(templatesPage: QuizTemplatesPage, name: string, description: string = '') {
  await templatesPage.createTemplate(name, description);
  await templatesPage.expectTemplateInList(name);
}

/**
 * Activate a template and return whether the API call succeeded.
 */
export async function activateTemplateAndWait(quizPage: QuizTemplatesQuizPage, name: string) {
  return await quizPage.activateTemplate(name);
}


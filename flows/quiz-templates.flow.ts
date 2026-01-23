import { QuizTemplatesPage } from '../pages/QuizTemplatesPage.js';

/**
 * Create a template and verify it appears in the list.
 * Optimized: No redundant refetch - React Query auto-invalidates after POST.
 */
export async function createTemplateAndWait(templatesPage: QuizTemplatesPage, name: string, description: string = '') {
  await templatesPage.createTemplate(name, description);
  await templatesPage.expectTemplateInList(name);
}

/**
 * Activate a template and return whether the API call succeeded.
 * Optimized: No redundant refetch - React Query auto-invalidates after PUT.
 */
export async function activateTemplateAndWait(templatesPage: QuizTemplatesPage, name: string) {
  return await templatesPage.activateTemplate(name);
}


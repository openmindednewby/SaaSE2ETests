import { QuizTemplatesPage } from '../pages/QuizTemplatesPage.js';

export async function createTemplateAndWait(templatesPage: QuizTemplatesPage, name: string, description: string = '') {
  await templatesPage.createTemplate(name, description);
  await templatesPage.expectTemplateInList(name);
}

export async function activateTemplateAndWait(templatesPage: QuizTemplatesPage, name: string) {
  const apiSuccess = await templatesPage.activateTemplate(name);
  await templatesPage.refetchTemplatesList();
  return apiSuccess;
}


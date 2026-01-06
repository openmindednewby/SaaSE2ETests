/**
 * Re-export testID constants from the client app
 *
 * This file re-exports the shared testID constants so Playwright tests
 * can use the same constants as the React components.
 *
 * Note: These constants must stay in sync with the client app.
 * If you can't import from the client app directly, keep these values
 * synchronized manually.
 */

// Ideally we'd import from the client app:
// export { TestIds, TestId } from '../../OnlineMenuSaaS/clients/OnlineMenuClientApp/src/shared/testIds';

// But for compatibility, we duplicate the constants here:
export const TestIds = {
  // Template components
  TEMPLATE_LIST: 'template-list',
  TEMPLATE_MODAL: 'template-modal',
  CREATE_TEMPLATE_FORM: 'create-template-form',

  // Generic list item (used by TenantListItem for various entity types)
  TENANT_LIST_ITEM: 'tenant-list-item',

  // Text elements
  HEADING_TEXT: 'heading-text',
  STATUS_LABEL: 'status-label',

  // Login page
  LOGIN_FORM: 'login-form',
  USERNAME_INPUT: 'username-input',
  PASSWORD_INPUT: 'password-input',
  LOGIN_BUTTON: 'login-button',

  // Navigation
  NAV_MENU: 'nav-menu',
  LOGOUT_BUTTON: 'logout-button',

  // Common actions
  EDIT_BUTTON: 'edit-button',
  DELETE_BUTTON: 'delete-button',
  SAVE_BUTTON: 'save-button',
  CANCEL_BUTTON: 'cancel-button',
  ACTIVATE_BUTTON: 'activate-button',

  // Loading states
  LOADING_INDICATOR: 'loading-indicator',

  // Quiz pages
  QUIZ_ACTIVE_PAGE: 'quiz-active-page',
  QUIZ_ANSWERS_PAGE: 'quiz-answers-page',
  QUIZ_TEMPLATES_PAGE: 'quiz-templates-page',
} as const;

// Type for testID values
export type TestId = typeof TestIds[keyof typeof TestIds];

// Selector helper for Playwright
export function testIdSelector(testId: TestId): string {
  return `[data-testid="${testId}"]`;
}

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
  DELETE_INACTIVE_BUTTON: 'delete-inactive-button',

  // Confirm dialog
  CONFIRM_DIALOG: 'confirm-dialog',
  CONFIRM_BUTTON: 'confirm-button',
  CANCEL_CONFIRM_BUTTON: 'cancel-confirm-button',

  // Loading states
  LOADING_INDICATOR: 'loading-indicator',

  // Quiz pages
  QUIZ_ACTIVE_PAGE: 'quiz-active-page',
  QUIZ_ANSWERS_PAGE: 'quiz-answers-page',
  QUIZ_TEMPLATES_PAGE: 'quiz-templates-page',

  // Online Menu Management
  MENU_LIST: 'menu-list',
  MENU_LIST_CREATE_BUTTON: 'menu-list-create-button',
  MENU_TAB_ALL: 'menu-tab-all',
  MENU_TAB_ACTIVE: 'menu-tab-active',
  MENU_CARD: 'menu-card',
  MENU_CARD_ID: 'menu-card-id',
  MENU_CARD_NAME: 'menu-card-name',
  MENU_CARD_DESCRIPTION: 'menu-card-description',
  MENU_CARD_STATUS_BADGE: 'menu-card-status-badge',
  MENU_CARD_EDIT_BUTTON: 'menu-card-edit-button',
  MENU_CARD_DELETE_BUTTON: 'menu-card-delete-button',
  MENU_CARD_ACTIVATE_BUTTON: 'menu-card-activate-button',
  MENU_CARD_DEACTIVATE_BUTTON: 'menu-card-deactivate-button',
  MENU_CARD_PREVIEW_BUTTON: 'menu-card-preview-button',
  MENU_CARD_OPEN_EXTERNAL_BUTTON: 'menu-card-open-external-button',
  MENU_PREVIEW_MODAL: 'menu-preview-modal',

  // Menu Editor
  MENU_EDITOR: 'menu-editor',
  MENU_EDITOR_NAME_INPUT: 'menu-editor-name-input',
  MENU_EDITOR_DESCRIPTION_INPUT: 'menu-editor-description-input',
  MENU_EDITOR_SAVE_BUTTON: 'menu-editor-save-button',
  MENU_EDITOR_CANCEL_BUTTON: 'menu-editor-cancel-button',
  MENU_EDITOR_THEME_SELECTOR: 'menu-editor-theme-selector',
  MENU_EDITOR_TITLE_FONT_INPUT: 'menu-editor-title-font-input',
  MENU_EDITOR_TITLE_FONT_SIZE_INPUT: 'menu-editor-title-font-size-input',
  MENU_EDITOR_BG_COLOR_PICKER: 'menu-editor-bg-color-picker',
  MENU_EDITOR_TEXT_COLOR_PICKER: 'menu-editor-text-color-picker',

  // Category Management
  CATEGORY_LIST: 'category-list',
  CATEGORY_ADD_BUTTON: 'category-add-button',
  CATEGORY_ITEM: 'category-item',
  CATEGORY_NAME_INPUT: 'category-name-input',
  CATEGORY_DESCRIPTION_INPUT: 'category-description-input',
  CATEGORY_EDIT_BUTTON: 'category-edit-button',
  CATEGORY_DELETE_BUTTON: 'category-delete-button',
  CATEGORY_DRAG_HANDLE: 'category-drag-handle',

  // Menu Item Management
  MENU_ITEM_LIST: 'menu-item-list',
  MENU_ITEM_ADD_BUTTON: 'menu-item-add-button',
  MENU_ITEM: 'menu-item',
  MENU_ITEM_NAME_INPUT: 'menu-item-name-input',
  MENU_ITEM_DESCRIPTION_INPUT: 'menu-item-description-input',
  MENU_ITEM_PRICE_INPUT: 'menu-item-price-input',
  MENU_ITEM_AVAILABLE_TOGGLE: 'menu-item-available-toggle',
  MENU_ITEM_EDIT_BUTTON: 'menu-item-edit-button',
  MENU_ITEM_DELETE_BUTTON: 'menu-item-delete-button',
  MENU_ITEM_DRAG_HANDLE: 'menu-item-drag-handle',

  // Live Preview
  LIVE_PREVIEW_PANEL: 'live-preview-panel',
  LIVE_PREVIEW_VIEWPORT_TOGGLE: 'live-preview-viewport-toggle',
  LIVE_PREVIEW_MOBILE: 'live-preview-mobile',
  LIVE_PREVIEW_TABLET: 'live-preview-tablet',
  LIVE_PREVIEW_DESKTOP: 'live-preview-desktop',

  // Public Menu Viewers
  PUBLIC_MENU_LIST: 'public-menu-list',
  PUBLIC_MENU_CARD: 'public-menu-card',
  PUBLIC_MENU_VIEWER: 'public-menu-viewer',
  PUBLIC_MENU_SHARE_BUTTON: 'public-menu-share-button',
  PUBLIC_MENU_CATEGORY: 'public-menu-category',
  PUBLIC_MENU_ITEM: 'public-menu-item',
} as const;

// Type for testID values
export type TestId = typeof TestIds[keyof typeof TestIds];

// Selector helper for Playwright
export function testIdSelector(testId: TestId): string {
  return `[data-testid="${testId}"]`;
}

// Selector helper for testIDs with suffixes (e.g., "public-menu-card-abc123")
export function testIdStartsWithSelector(testId: TestId): string {
  return `[data-testid^="${testId}"]`;
}

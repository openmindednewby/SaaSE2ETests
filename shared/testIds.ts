/**
 * Shared testID constants for E2E testing
 *
 * These constants are used both in React Native components and Playwright E2E tests
 * to ensure consistency and avoid magic strings.
 *
 * Usage in React components:
 *   import { TestIds } from '../shared/testIds';
 *   <View testID={TestIds.TEMPLATE_LIST}>
 *
 * Usage in Playwright tests:
 *   import { TestIds } from '../../OnlineMenuSaaS/clients/OnlineMenuClientApp/src/shared/testIds';
 *   page.locator(`[data-testid="${TestIds.TEMPLATE_LIST}"]`)
 */

export const TestIds = {
  // Template components
  TEMPLATE_LIST: 'template-list',
  TEMPLATE_MODAL: 'template-modal',
  CREATE_TEMPLATE_FORM: 'create-template-form',
  TEMPLATE_NAME_INPUT: 'template-name-input',
  TEMPLATE_STATUS_ACTIVE_BUTTON: 'template-status-active-button',
  TEMPLATE_STATUS_INACTIVE_BUTTON: 'template-status-inactive-button',

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
  MENU_LIST_REFRESH_BUTTON: 'menu-list-refresh-button',
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
  CATEGORY_IMAGE_PICKER: 'category-image-picker',
  CATEGORY_VIDEO_PICKER: 'category-video-picker',

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
  MENU_ITEM_IMAGE_PICKER: 'menu-item-image-picker',
  MENU_ITEM_VIDEO_PICKER: 'menu-item-video-picker',
  MENU_ITEM_DOCUMENT_PICKER: 'menu-item-document-picker',

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

  // Content Upload Components
  CONTENT_UPLOADER: 'content-uploader',
  CONTENT_UPLOADER_BUTTON: 'content-uploader-button',
  CONTENT_UPLOADER_ERROR: 'content-uploader-error',
  CONTENT_PREVIEW: 'content-preview',
  CONTENT_PREVIEW_IMAGE: 'content-preview-image',
  CONTENT_PREVIEW_VIDEO_THUMBNAIL: 'content-preview-video-thumbnail',
  CONTENT_PREVIEW_DOCUMENT: 'content-preview-document',
  CONTENT_PREVIEW_DELETE_BUTTON: 'content-preview-delete-button',
  UPLOAD_PROGRESS_CONTAINER: 'upload-progress-container',
  UPLOAD_PROGRESS_FILE_NAME: 'upload-progress-file-name',
  UPLOAD_PROGRESS_BAR: 'upload-progress-bar',
  UPLOAD_PROGRESS_CANCEL_BUTTON: 'upload-progress-cancel-button',
  IMAGE_PICKER: 'image-picker',
  VIDEO_PICKER: 'video-picker',
  DOCUMENT_PICKER: 'document-picker',
  CONTENT_IMAGE: 'content-image',
  CONTENT_IMAGE_CATEGORY: 'content-image-category',
  CONTENT_IMAGE_MENU_ITEM: 'content-image-menu-item',
  CONTENT_VIDEO: 'content-video',
  CONTENT_VIDEO_CATEGORY: 'content-video-category',
  CONTENT_VIDEO_MENU_ITEM: 'content-video-menu-item',
} as const;

// Type for testID values
export type TestId = typeof TestIds[keyof typeof TestIds];

/**
 * Helper function to create a data-testid selector for Playwright
 * @param testId - The test ID constant from TestIds
 * @returns A CSS selector string for use with page.locator()
 */
export function testIdSelector(testId: TestId): string {
  return `[data-testid="${testId}"]`;
}

/**
 * Helper function to create a data-testid selector that matches elements
 * whose testid starts with the given prefix.
 * Useful for matching dynamically generated IDs like "menu-card-123"
 * @param testId - The test ID prefix to match
 * @returns A CSS selector string for use with page.locator()
 */
export function testIdStartsWithSelector(testId: TestId): string {
  return `[data-testid^="${testId}"]`;
}

/**
 * Helper function to create an indexed data-testid selector.
 * Useful for matching elements with indexed IDs like "category-item-0", "menu-item-0-1"
 * @param testId - The base test ID constant from TestIds
 * @param indices - One or more indices to append to the testId (e.g., categoryIndex, itemIndex)
 * @returns A CSS selector string for use with page.locator()
 */
export function indexedTestIdSelector(testId: TestId, ...indices: number[]): string {
  const indexSuffix = indices.join('-');
  return `[data-testid="${testId}-${indexSuffix}"]`;
}

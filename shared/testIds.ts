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
 *   import { TestIds } from '../shared/testIds.js';
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

  // Tenant Selector (User Management)
  TENANT_SELECTOR_ALL_USERS: 'tenant-selector-all-users',
  TENANT_SELECTOR_ITEM: 'tenant-selector-item',

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
  CATEGORY_TOGGLE_BUTTON: 'category-toggle-button',
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

  // Notifications
  NOTIFICATION_BELL: 'notification-bell',
  NOTIFICATION_BELL_BADGE: 'notification-bell-badge',
  NOTIFICATION_SCREEN: 'notification-screen',
  NOTIFICATION_LIST: 'notification-list',
  NOTIFICATION_ITEM: 'notification-item',
  NOTIFICATION_MARK_ALL_READ: 'notification-mark-all-read',
  NOTIFICATION_EMPTY_STATE: 'notification-empty-state',
  NOTIFICATION_CONNECTION_STATUS: 'notification-connection-status',
  NOTIFICATION_TOAST_CONTAINER: 'notification-toast-container',
  NOTIFICATION_TOAST: 'notification-toast',
  NOTIFICATION_TOAST_DISMISS: 'notification-toast-dismiss',
  // Notification Permission
  NOTIFICATION_PERMISSION_BANNER: 'notification-permission-banner',
  NOTIFICATION_PERMISSION_ENABLE_BUTTON: 'notification-permission-enable-button',
  NOTIFICATION_PERMISSION_LATER_BUTTON: 'notification-permission-later-button',

  // Notification Preferences
  NOTIFICATION_PREFERENCES_SCREEN: 'notification-preferences-screen',
  NOTIFICATION_PREFERENCES_SAVE_BUTTON: 'notification-preferences-save-button',
  NOTIFICATION_PREFERENCE_DROPDOWN: 'notification-preference-dropdown',
  NOTIFICATION_SETTINGS_BUTTON: 'notification-settings-button',

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

  // Color Scheme Editor
  COLOR_SCHEME_EDITOR: 'color-scheme-editor',
  COLOR_SCHEME_INPUT: 'color-scheme-input',
  COLOR_SCHEME_INPUT_ROW: 'color-scheme-input-row',
  COLOR_SCHEME_SWATCH: 'color-scheme-swatch',
  COLOR_SCHEME_PRESET: 'color-scheme-preset',
  COLOR_SCHEME_RESET_BUTTON: 'color-scheme-reset-button',

  // Typography Editor
  TYPOGRAPHY_EDITOR: 'typography-editor',
  TYPOGRAPHY_SECTION: 'typography-section',
  TYPOGRAPHY_FONT_PICKER: 'typography-font-picker',
  TYPOGRAPHY_SIZE_INPUT: 'typography-size-input',
  TYPOGRAPHY_WEIGHT_PICKER: 'typography-weight-picker',
  TYPOGRAPHY_PREVIEW: 'typography-preview',
  TYPOGRAPHY_RESET_BUTTON: 'typography-reset-button',

  // Price Style Editor
  PRICE_STYLE_EDITOR: 'price-style-editor',
  PRICE_STYLE_FONT_SIZE_SLIDER: 'price-style-font-size-slider',
  PRICE_STYLE_FONT_WEIGHT_DROPDOWN: 'price-style-font-weight-dropdown',
  PRICE_STYLE_COLOR_INPUT: 'price-style-color-input',
  PRICE_STYLE_COLOR_SWATCH: 'price-style-color-swatch',
  PRICE_STYLE_CURRENCY_POSITION_BEFORE: 'price-style-currency-position-before',
  PRICE_STYLE_CURRENCY_POSITION_AFTER: 'price-style-currency-position-after',
  PRICE_STYLE_SHOW_CURRENCY_TOGGLE: 'price-style-show-currency-toggle',
  PRICE_STYLE_STRIKETHROUGH_TOGGLE: 'price-style-strikethrough-toggle',
  PRICE_STYLE_PREVIEW: 'price-style-preview',

  // Media Position Editor
  MEDIA_POSITION_EDITOR: 'media-position-editor',
  MEDIA_POSITION_BUTTON: 'media-position-button',
  MEDIA_SIZE_BUTTON: 'media-size-button',
  MEDIA_FIT_BUTTON: 'media-fit-button',
  MEDIA_BORDER_RADIUS_SLIDER: 'media-border-radius-slider',
  MEDIA_SHOW_TOGGLE: 'media-show-toggle',
  MEDIA_PREVIEW: 'media-preview',

  // Box Style Editor
  BOX_STYLE_EDITOR: 'box-style-editor',
  BOX_STYLE_PREVIEW: 'box-style-preview',
  BOX_STYLE_BACKGROUND_COLOR_INPUT: 'box-style-background-color-input',
  BOX_STYLE_BACKGROUND_COLOR_SWATCH: 'box-style-background-color-swatch',
  BOX_STYLE_BORDER_COLOR_INPUT: 'box-style-border-color-input',
  BOX_STYLE_BORDER_COLOR_SWATCH: 'box-style-border-color-swatch',
  BOX_STYLE_BORDER_WIDTH_SLIDER: 'box-style-border-width-slider',
  BOX_STYLE_BORDER_WIDTH_DECREASE: 'box-style-border-width-decrease',
  BOX_STYLE_BORDER_WIDTH_INCREASE: 'box-style-border-width-increase',
  BOX_STYLE_BORDER_RADIUS_SLIDER: 'box-style-border-radius-slider',
  BOX_STYLE_BORDER_RADIUS_DECREASE: 'box-style-border-radius-decrease',
  BOX_STYLE_BORDER_RADIUS_INCREASE: 'box-style-border-radius-increase',
  BOX_STYLE_PADDING_SLIDER: 'box-style-padding-slider',
  BOX_STYLE_PADDING_DECREASE: 'box-style-padding-decrease',
  BOX_STYLE_PADDING_INCREASE: 'box-style-padding-increase',
  BOX_STYLE_SHADOW_TOGGLE: 'box-style-shadow-toggle',

  // Header Editor
  HEADER_EDITOR: 'header-editor',
  HEADER_EDITOR_PREVIEW: 'header-editor-preview',
  HEADER_EDITOR_SHOW_LOGO_TOGGLE: 'header-editor-show-logo-toggle',
  HEADER_EDITOR_LOGO_POSITION_LEFT: 'header-editor-logo-position-left',
  HEADER_EDITOR_LOGO_POSITION_CENTER: 'header-editor-logo-position-center',
  HEADER_EDITOR_LOGO_POSITION_RIGHT: 'header-editor-logo-position-right',
  HEADER_EDITOR_LOGO_SIZE_SMALL: 'header-editor-logo-size-small',
  HEADER_EDITOR_LOGO_SIZE_MEDIUM: 'header-editor-logo-size-medium',
  HEADER_EDITOR_LOGO_SIZE_LARGE: 'header-editor-logo-size-large',
  HEADER_EDITOR_BANNER_HEIGHT_SLIDER: 'header-editor-banner-height-slider',
  HEADER_EDITOR_SHOW_MENU_NAME_TOGGLE: 'header-editor-show-menu-name-toggle',
  HEADER_EDITOR_SHOW_MENU_DESCRIPTION_TOGGLE: 'header-editor-show-menu-description-toggle',
  HEADER_EDITOR_TITLE_POSITION_LEFT: 'header-editor-title-position-left',
  HEADER_EDITOR_TITLE_POSITION_CENTER: 'header-editor-title-position-center',
  HEADER_EDITOR_TITLE_POSITION_RIGHT: 'header-editor-title-position-right',

  // Global Styling Tab
  GLOBAL_STYLING_TAB: 'global-styling-tab',
  GLOBAL_STYLING_TAB_LAYOUT: 'global-styling-tab-layout',
  GLOBAL_STYLING_TAB_COLORS: 'global-styling-tab-colors',
  GLOBAL_STYLING_TAB_TYPOGRAPHY: 'global-styling-tab-typography',
  GLOBAL_STYLING_TAB_MEDIA: 'global-styling-tab-media',
  GLOBAL_STYLING_TAB_HEADER: 'global-styling-tab-header',
  GLOBAL_STYLING_TAB_SPACING: 'global-styling-tab-spacing',
  GLOBAL_STYLING_SECTION_HEADER: 'global-styling-section-header',
  GLOBAL_STYLING_SECTION_CONTENT: 'global-styling-section-content',

  // Spacing Settings Editor
  SPACING_EDITOR: 'spacing-editor',
  SPACING_PAGE_PADDING_SLIDER: 'spacing-page-padding-slider',
  SPACING_CATEGORY_SPACING_SLIDER: 'spacing-category-spacing-slider',
  SPACING_ITEM_SPACING_SLIDER: 'spacing-item-spacing-slider',
  SPACING_CONTENT_PADDING_SLIDER: 'spacing-content-padding-slider',

  // Category Styling Section
  CATEGORY_STYLING_SECTION: 'category-styling-section',
  CATEGORY_STYLING_TOGGLE: 'category-styling-toggle',
  CATEGORY_STYLING_CONTENT: 'category-styling-content',
  CATEGORY_STYLING_BOX_EDITOR: 'category-styling-box-editor',
  CATEGORY_STYLING_MEDIA_EDITOR: 'category-styling-media-editor',

  // Item Styling Section
  ITEM_STYLING_SECTION: 'item-styling-section',
  ITEM_STYLING_HEADER: 'item-styling-header',
  ITEM_STYLING_CONTENT: 'item-styling-content',

  // Menu Content View (Display)
  MENU_CONTENT_VIEW: 'menu-content-view',
  MENU_CONTENT_VIEW_HEADER: 'menu-content-view-header',
  MENU_CONTENT_VIEW_BANNER: 'menu-content-view-banner',
  MENU_CONTENT_VIEW_LOGO: 'menu-content-view-logo',
  MENU_CONTENT_VIEW_TITLE: 'menu-content-view-title',
  MENU_CONTENT_VIEW_DESCRIPTION: 'menu-content-view-description',
  MENU_CONTENT_VIEW_CATEGORIES: 'menu-content-view-categories',
  MENU_CONTENT_VIEW_EMPTY: 'menu-content-view-empty',
  MENU_CONTENT_VIEW_CATEGORY_SECTION: 'menu-content-view-category-section',
  MENU_CONTENT_VIEW_MENU_ITEM: 'menu-content-view-menu-item',

  // Native Forms Showcase
  NATIVE_FORMS_PAGE: 'native-forms-page',
  SHOWCASE_LOGIN_EMAIL: 'showcase-login-email',
  SHOWCASE_LOGIN_PASSWORD: 'showcase-login-password',
  SHOWCASE_LOGIN_PASSWORD_TOGGLE: 'showcase-login-password-toggle',
  SHOWCASE_LOGIN_REMEMBER: 'showcase-login-remember',
  SHOWCASE_LOGIN_SUBMIT: 'showcase-login-submit',
  SHOWCASE_REGISTER_NAME: 'showcase-register-name',
  SHOWCASE_REGISTER_EMAIL: 'showcase-register-email',
  SHOWCASE_REGISTER_PASSWORD: 'showcase-register-password',
  SHOWCASE_REGISTER_CONFIRM_PASSWORD: 'showcase-register-confirm-password',
  SHOWCASE_REGISTER_SUBMIT: 'showcase-register-submit',
  SHOWCASE_CONTACT_NAME: 'showcase-contact-name',
  SHOWCASE_CONTACT_EMAIL: 'showcase-contact-email',
  SHOWCASE_CONTACT_SUBJECT: 'showcase-contact-subject',
  SHOWCASE_CONTACT_MESSAGE: 'showcase-contact-message',
  SHOWCASE_CONTACT_SUBMIT: 'showcase-contact-submit',
  SHOWCASE_NEWSLETTER_EMAIL: 'showcase-newsletter-email',
  SHOWCASE_NEWSLETTER_SUBMIT: 'showcase-newsletter-submit',

  // SyncfusionThemeStudio - Login
  STUDIO_LOGIN_USERNAME: 'login-username',
  STUDIO_LOGIN_PASSWORD: 'login-password',
  STUDIO_LOGIN_SUBMIT: 'login-submit',

  // SyncfusionThemeStudio - Native Components Page
  STUDIO_NATIVE_COMPONENTS_PAGE: 'native-components-page',
  STUDIO_NATIVE_CHECKBOX_CHECKED: 'native-checkbox-checked',
  STUDIO_NATIVE_CHECKBOX_UNCHECKED: 'native-checkbox-unchecked',
  STUDIO_NATIVE_CHECKBOX_DISABLED: 'native-checkbox-disabled',
  STUDIO_NATIVE_CHECKBOX_INDETERMINATE: 'native-checkbox-indeterminate',

  // SyncfusionThemeStudio - Products Pages
  STUDIO_NATIVE_PRODUCTS_PAGE: 'native-products-page',
  STUDIO_NATIVE_PRODUCTS_GRID: 'native-products-grid',
  STUDIO_PRODUCTS_GRID: 'products-grid',
  STUDIO_PRODUCTS_CATEGORY_FILTER: 'products-category-filter',
  STUDIO_BTN_RETRY: 'btn-retry',

  // SyncfusionThemeStudio - Theme Settings Drawer
  STUDIO_THEME_SETTINGS_DRAWER: 'theme-settings-drawer',
  STUDIO_THEME_SETTINGS_BUTTON: 'theme-settings-button',
  STUDIO_THEME_PRESET_CARD: 'theme-preset-card',
  STUDIO_THEME_TAB_PRESETS: 'theme-tab-presets',
  STUDIO_THEME_TAB_LAYOUT: 'theme-tab-layout',
  STUDIO_THEME_CLOSE_BTN: 'theme-close-btn',

  // SyncfusionThemeStudio - Layout Settings
  STUDIO_LAYOUT_FULL_WIDTH_CHECKBOX: 'layout-full-width-checkbox',

  // Tenant Theme Editor
  TENANT_THEME_EDITOR_SCREEN: 'tenant-theme-editor-screen',
  TENANT_THEME_EDITOR_LOADING: 'tenant-theme-editor-loading',
  TENANT_THEME_EDITOR_SAVE: 'tenant-theme-editor-save',
  TENANT_THEME_EDITOR_RESET: 'tenant-theme-editor-reset',
  TENANT_THEME_COLOR_PRIMARY: 'tenant-theme-color-primary',
  TENANT_THEME_COLOR_SECONDARY: 'tenant-theme-color-secondary',
  TENANT_THEME_COLOR_ACCENT: 'tenant-theme-color-accent',
  TENANT_THEME_PREVIEW: 'tenant-theme-preview',
  TENANT_THEME_TYPOGRAPHY_SCALE: 'tenant-theme-typography-scale',
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

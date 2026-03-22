import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import noWaitForTimeoutPlugin from './eslint-plugins/no-wait-for-timeout.mjs';
import noSetTimeoutInPromisePlugin from './eslint-plugins/no-set-timeout-in-promise.mjs';
import noNetworkidlePlugin from './eslint-plugins/no-networkidle.mjs';
import noConsoleInTestsPlugin from './eslint-plugins/no-console-in-tests.mjs';
import noLocatorOrChainPlugin from './eslint-plugins/no-locator-or-chain.mjs';
import noPageReloadPlugin from './eslint-plugins/no-page-reload.mjs';
import maxFileLinesPlugin from './eslint-plugins/max-file-lines.mjs';
import noFragileSelectorsPlugin from './eslint-plugins/no-fragile-selectors.mjs';
import noWaitUntilSlowPlugin from './eslint-plugins/no-wait-until-slow.mjs';
import noRedundantVisibilityPlugin from './eslint-plugins/no-redundant-visibility.mjs';
import maxTestsPerBatchPlugin from './eslint-plugins/max-tests-per-batch.mjs';
import maxTestsPerFilePlugin from './eslint-plugins/max-tests-per-file.mjs';

export default [
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'reports/**',
      'playwright/**',
      'scripts/**',
      'eslint-plugins/**',
      '*.cjs',
      '*.mjs',
    ],
  },

  // Base JavaScript rules
  js.configs.recommended,

  // TypeScript configuration for all .ts files
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'no-wait-for-timeout': noWaitForTimeoutPlugin,
      'no-set-timeout-in-promise': noSetTimeoutInPromisePlugin,
      'no-networkidle': noNetworkidlePlugin,
      'no-console-in-tests': noConsoleInTestsPlugin,
      'no-locator-or-chain': noLocatorOrChainPlugin,
      'no-page-reload': noPageReloadPlugin,
      'max-file-lines': maxFileLinesPlugin,
      'no-fragile-selectors': noFragileSelectorsPlugin,
      'no-wait-until-slow': noWaitUntilSlowPlugin,
      'no-redundant-visibility': noRedundantVisibilityPlugin,
      'max-tests-per-batch': maxTestsPerBatchPlugin,
      'max-tests-per-file': maxTestsPerFilePlugin,
    },
    rules: {
      // TypeScript handles undefined identifiers
      'no-undef': 'off',

      // Disable base ESLint rules handled by TypeScript
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'require-await': 'off',

      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // =====================================================
      // E2E PLAYWRIGHT CUSTOM RULES
      // =====================================================

      // Performance killers - error severity
      'no-wait-for-timeout/no-wait-for-timeout': 'error',
      'no-set-timeout-in-promise/no-set-timeout-in-promise': 'error',
      'no-networkidle/no-networkidle': 'error',
      'no-console-in-tests/no-console-in-tests': 'error',
      'no-locator-or-chain/no-locator-or-chain': 'error',
      'no-fragile-selectors/no-fragile-selectors': 'error',
      'no-wait-until-slow/no-wait-until-slow': 'error',

      // Warnings - legitimate uses exist or requires larger refactor
      'no-page-reload/no-page-reload': 'warn',
      'max-file-lines/max-file-lines': ['warn', { max: 300 }],
      'no-redundant-visibility/no-redundant-visibility': 'warn',

      // Per-file test count limit
      'max-tests-per-file/max-tests-per-file': ['error', { max: 50 }],

      // Batch size limit: max 100 total tests per Tilt E2E batch
      // (uniqueTests × 3 browsers + 2 setup = max 100 → max 32 unique per batch)
      'max-tests-per-batch/max-tests-per-batch': ['warn', {
        max: 100,
        browserMultiplier: 3,
        setupOverhead: 2,
        subBatches: {
          // Online Menus (existing sub-batches)
          'online-menus-crud': [
            'menu-activation.spec.ts',
            'menu-crud-with-activation.spec.ts',
            'menu-status-display.spec.ts',
            'menu-display-order-sorting.spec.ts',
          ],
          'online-menus-editor': [
            'menu-editor-categories-focus.spec.ts',
            'menu-editor-categories-crud.spec.ts',
            'menu-editor-categories-switching.spec.ts',
            'menu-content-upload-basic.spec.ts',
            'menu-content-upload-create.spec.ts',
            'menu-content-upload-advanced.spec.ts',
            'menu-duplicate-names.spec.ts',
          ],
          'online-menus-public': [
            'menu-preview-and-external-link.spec.ts',
            'menu-public-page-load-basic.spec.ts',
            'menu-public-page-load-viewer.spec.ts',
            'public-viewer-active-filtering-basic.spec.ts',
            'public-viewer-active-filtering-states.spec.ts',
          ],
          'online-menus-qr': [
            'menu-qr-code.spec.ts',
          ],

          // Questioner sub-batches (49 total tests across 3 sub-batches)
          'questioner-active': [
            'fill-quiz.spec.ts',
            'quiz-multipage-validation.spec.ts',
            'quiz-multipage-navigation.spec.ts',
            'submit-quiz.spec.ts',
          ],
          'questioner-answers': [
            'quiz-answers-export-filter.spec.ts',
            'view-answers.spec.ts',
          ],
          'questioner-templates': [
            'activate-template.spec.ts',
            'active-quiz-limit.spec.ts',
            'create-template.spec.ts',
            'delete-inactive-templates.spec.ts',
            'edit-template.spec.ts',
            'tenant-isolation.spec.ts',
          ],

          // Showcase sub-batches (67 total tests across 3 sub-batches)
          'showcase-native-forms-a': [
            'native-forms-combobox.spec.ts',
            'native-forms-validation.spec.ts',
            'native-forms-fields.spec.ts',
          ],
          'showcase-native-forms-b': [
            'native-forms-animations.spec.ts',
            'native-forms-dark-theme.spec.ts',
          ],
          'showcase-other': [
            'layout-full-width.spec.ts',
            'native-components.spec.ts',
            'native-forms.spec.ts',
            'products-api.spec.ts',
            'theme-preset-cards.spec.ts',
          ],

          // Billing sub-batches (37 total tests across 2 sub-batches)
          'billing-subscription': [
            'billing-subscription.spec.ts',
            'billing-subscription-flow.spec.ts',
            'billing-cancellation.spec.ts',
          ],
          'billing-pricing': [
            'billing-pricing-page.spec.ts',
            'billing-upgrade-downgrade.spec.ts',
            'billing-history.spec.ts',
          ],

          // Notification sub-batches (142 total tests across 3 sub-batches)
          'notification-ui': [
            'notification-screen.spec.ts',
            'notification-screen-navigation.spec.ts',
            'health.spec.ts',
          ],
          'notification-alerts': [
            'notification-toast.spec.ts',
            'notification-badge.spec.ts',
            'cross-tab.spec.ts',
          ],
          'notification-infra': [
            'realtime.spec.ts',
            'connection.spec.ts',
            'stress-volume.spec.ts',
            'stress-resilience.spec.ts',
          ],

          // Menu Styling sub-batches (61 total tests across 3 sub-batches)
          'menu-styling-colors': [
            'color-scheme.spec.ts',
            'color-scheme-save.spec.ts',
            'layout-templates.spec.ts',
          ],
          'menu-styling-typography': [
            'typography.spec.ts',
            'typography-advanced.spec.ts',
            'persistence.spec.ts',
            'persistence-reload.spec.ts',
          ],
          'menu-styling-category': [
            'category-styling.spec.ts',
            'category-styling-advanced.spec.ts',
          ],

          // Theme-Studio sub-batches (109 total tests across 4 sub-batches)
          'theme-studio-dialogs': [
            'dialog-accessibility-custom.spec.ts',
            'dialog-accessibility-hook.spec.ts',
            'button-functionality-pricing.spec.ts',
          ],
          'theme-studio-dark': [
            'dark-mode-flash.spec.ts',
            'dark-mode-toggle.spec.ts',
            'dark-mode-badges.spec.ts',
            'semantic-dark-mode-badges-admin.spec.ts',
            'semantic-dark-mode-badges-roles.spec.ts',
          ],
          'theme-studio-navigation': [
            'settings-tab-navigation.spec.ts',
            'button-functionality-login.spec.ts',
          ],
          'theme-studio-misc': [
            'accessibility-labels.spec.ts',
            'breadcrumb-keys.spec.ts',
            'button-functionality.spec.ts',
            'chat-signalr.spec.ts',
            'dark-mode.spec.ts',
            'dark-mode-theme.spec.ts',
            'dialog-accessibility.spec.ts',
            'externallink-sizing.spec.ts',
            'integration-aria-labels.spec.ts',
            'landing-footer-semantic.spec.ts',
            'pricing-overflow.spec.ts',
            'semantic-dark-mode-badges.spec.ts',
            'toast-duration.spec.ts',
          ],
        },
      }],
    },
  },

  // Override: allow console in fixtures, helpers, and teardown files
  {
    files: [
      'fixtures/**/*.ts',
      'helpers/**/*.ts',
      'tests/multi-tenant.teardown.ts',
    ],
    rules: {
      'no-console-in-tests/no-console-in-tests': 'off',
    },
  },
];

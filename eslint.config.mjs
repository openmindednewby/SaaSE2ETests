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

      // Batch size limit: max 100 total tests per Tilt E2E batch
      // (uniqueTests × 3 browsers + 2 setup = max 100 → max 32 unique per batch)
      'max-tests-per-batch/max-tests-per-batch': ['warn', {
        max: 100,
        browserMultiplier: 3,
        setupOverhead: 2,
        subBatches: {
          'online-menus-crud': [
            'menu-activation.spec.ts',
            'menu-crud-with-activation.spec.ts',
            'menu-status-display.spec.ts',
            'menu-display-order-sorting.spec.ts',
          ],
          'online-menus-editor': [
            'menu-editor-categories.spec.ts',
            'menu-content-upload.spec.ts',
            'menu-duplicate-names.spec.ts',
          ],
          'online-menus-public': [
            'menu-preview-and-external-link.spec.ts',
            'menu-public-page-load.spec.ts',
            'public-viewer-active-filtering.spec.ts',
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

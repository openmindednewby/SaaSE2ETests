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
      // One-off screenshot capture scripts + their PNG baselines, not tests.
      // kefi-align/capture.js turned e2e-lint red on 2026-09-08 and, via
      // resource_deps, blocked every playwright-e2e-* Tilt resource.
      'visual-baselines/**',
      // AML fuzzy-match measurement scripts, not specs: their console output
      // IS the result. They turned e2e-lint red on 2026-09-11 (23 errors).
      'tests/aml/fuzzy-*.ts',
      // Playwright trace viewer / report artifacts. These contain minified
      // browser bundles (uiMode.*.js, trace bundles) that ESLint should not
      // lint — they generate hundreds of no-undef / no-fallthrough errors
      // from third-party code we don't own. The `playwright-report*` glob
      // covers both `playwright-report/` and `playwright-report-games/`
      // (the games suite writes to a separate output dir).
      '**/playwright-report*/**',
      'test-results/**',
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
      // (uniqueTests × 1 browser + 2 setup = max 100 → max 98 unique per batch;
      // chromium-only since 2026-05-20)
      'max-tests-per-batch/max-tests-per-batch': ['warn', {
        max: 100,
        browserMultiplier: 1,
        setupOverhead: 2,
        subBatches: {
          // Online Menus (existing sub-batches)
          'online-menus-crud': [
            'menu-activation.spec.ts',
            'menu-crud-with-activation.spec.ts',
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

          // Questioner sub-batches
          'questioner-active': [
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

          // Kefi sub-batches (103 total tests across 2 sub-batches). `kefi-ubb`
          // pulls out the Universal-Booking-Bundle ticket/pricing specs (the
          // `kefi-ubb-*` naming family); everything else stays in `kefi-core`.
          // Every spec in tests/kefi/ must be listed in one of these two, or it
          // falls back to the whole-directory count (103) and re-trips this rule.
          'kefi-ubb': [
            'kefi-ubb-mobile-picker.spec.ts',
            'kefi-ubb-mobile-payment.spec.ts',
            'kefi-ubb-mobile-register.spec.ts',
            'kefi-ubb-pass-numbers.spec.ts',
            'kefi-ubb-payment-to-ticket.spec.ts',
            'kefi-ubb-picker-resilience.spec.ts',
            'kefi-ubb-price-parity.spec.ts',
            'kefi-ubb-promoters-mobile.spec.ts',
            'kefi-ubb-ticket-mobile.spec.ts',
            'kefi-ubb-ticket-surface-api.spec.ts',
            'kefi-ubb-ticket-surface-ui.spec.ts',
            'kefi-ubb-tiered-pricing.spec.ts',
          ],
          'kefi-core': [
            'kefi-access-link-dead-vs-forbidden.spec.ts',
            'kefi-access-link-expiry.spec.ts',
            'kefi-access-links.spec.ts',
            'kefi-attendee-delete.spec.ts',
            'kefi-attendee-export.spec.ts',
            'kefi-attendee-import.spec.ts',
            'kefi-attendee-payment.spec.ts',
            'kefi-backoffice-approval.spec.ts',
            'kefi-crew-lifecycle.spec.ts',
            'kefi-crew-link-states.spec.ts',
            'kefi-crew-payout.spec.ts',
            'kefi-critical-path.spec.ts',
            'kefi-custom-domain.spec.ts',
            'kefi-device-pin-unlock.spec.ts',
            'kefi-door-checkin.spec.ts',
            'kefi-email-delivery.spec.ts',
            'kefi-email-lifecycle.spec.ts',
            'kefi-free-publish.spec.ts',
            'kefi-gdpr.spec.ts',
            'kefi-ledger-pnl.spec.ts',
            'kefi-mark-paid.spec.ts',
            'kefi-message-template-defaults.spec.ts',
            'kefi-message-templates-crud.spec.ts',
            'kefi-message-templates.spec.ts',
            'kefi-multi-event-publish.spec.ts',
            'kefi-organizer-access-link-regression.spec.ts',
            'kefi-organizer-pnl.spec.ts',
            'kefi-organizer-tabs.spec.ts',
            'kefi-otp-login.spec.ts',
            'kefi-passkey-login.spec.ts',
            'kefi-poster-passes-render.spec.ts',
            'kefi-print-affordance.spec.ts',
            'kefi-pro-gates-api.spec.ts',
            'kefi-pro-gates-ui.spec.ts',
            'kefi-pro-gates.spec.ts',
            'kefi-public-registration.spec.ts',
            'kefi-qr-checkin.spec.ts',
            'kefi-registration-approval.spec.ts',
            'kefi-registration-notifications-mobile.spec.ts',
            'kefi-registration-notifications-validation.spec.ts',
            'kefi-registration-notifications.spec.ts',
            'kefi-reset-revokes-devices.spec.ts',
            'kefi-role-surfaces.spec.ts',
            'kefi-tenant-landing-health.spec.ts',
            'kefi-tenant-lifecycle.spec.ts',
          ],

          // Zygos / FINREG payment-ops sub-batches (ZY-18 + P-04/06/07/08 + P-PAY-12).
          // Mirrors the REAL runtime split — `zygos-api` and `zygos-ui` are already
          // separate Playwright projects (playwright.projects.ts), so counting the
          // whole tests/zygos directory as one batch over-counts across a boundary
          // that never runs together. Every zygos spec must live in one of these
          // lists; a new spec not listed falls back to the whole-directory count and
          // re-trips this rule — which is the intended nudge to categorise it. The
          // FINREG-payments (P-PAY-12) specs get their own api/ui sub-batches so the
          // core `zygos-api` list stays under the 100-test ceiling.
          'zygos-api': [
            'zygos-accounting.spec.ts',
            'zygos-accounting-crossmodule.spec.ts',
            'zygos-audit.spec.ts',
            'zygos-crm-contacts.spec.ts',
            'zygos-auth.spec.ts',
            'zygos-batch-maker-checker.spec.ts',
            'zygos-batches.spec.ts',
            'zygos-commission.spec.ts',
            'zygos-imports.spec.ts',
            'zygos-lifecycle.spec.ts',
            'zygos-list-query.spec.ts',
            'zygos-maker-checker.spec.ts',
            'zygos-public-surface.spec.ts',
            'zygos-pwa.spec.ts',
            'zygos-schedules.spec.ts',
            'zygos-tampering.spec.ts',
            'zygos-tenant-isolation.spec.ts',
            'zygos-ux6a-strings.spec.ts',
          ],
          'zygos-payments-api': [
            'zygos-payments.spec.ts',
          ],
          // Standalone repro/regression specs that run in the zygos-api project but are
          // their own concern — kept out of the core `zygos-api` list so neither pushes
          // the other over the 100-test ceiling.
          'zygos-repro': [
            'zygos-mobile-drawer-nav.repro.spec.ts',
          ],
          'zygos-ui': [
            'zygos-console.ui.spec.ts',
            'zygos-form-fields.ui.spec.ts',
            'zygos-form-wrap.ui.spec.ts',
            'zygos-guide.ui.spec.ts',
            'zygos-i18n.ui.spec.ts',
            'zygos-master-console.ui.spec.ts',
            'zygos-master-pages.ui.spec.ts',
            'zygos-nav-order.ui.spec.ts',
            'zygos-pager.ui.spec.ts',
            'zygos-payments-form.ui.spec.ts',
            'zygos-payments-corridor.ui.spec.ts',
          ],
          // Non-UI specs that predate the zygos-api list above and would push it
          // over the ceiling if merged in (zygos-api is already at 97/98 unique).
          'zygos-console': [
            'zygos-account-contract.spec.ts',
            'zygos-master-console.spec.ts',
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

  // Standalone CommonJS scripts (e.g. stripe-smoke.js) — manual smoke runners
  // executed via `node`, not part of the Playwright suite. They legitimately use
  // Node globals (require / process / console), so declare them to satisfy the
  // base `no-undef` rule (.cjs/.mjs are ignored above; bare .js needs this).
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
];

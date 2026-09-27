# QUARANTINE - tests excluded from every scheduled run

TEST-5MIN-1a "Quarantine + no retries + <=240 s groups". A test red in >= 5 of the last 7 full nightly runs of a target is excluded from scheduled runs (`E2E_SCHEDULED=1` / `E2E_GROUP_INDEX`) and never runs on a schedule (owner decision Q4 "quarantine never"). Each spec needs an owner/ticket so the list shrinks.

- Run the lane by hand: `E2E_TARGET=<staging|prod> E2E_QUARANTINE=1 npx playwright test`.
- Test-level list (exact titles): `scheduled/quarantine.json`. Regenerate after fixes: see `scheduled/build-groups.py`.
- `red since` = first red run inside the 7-run window; it may have gone red earlier. Generated 2026-09-27.

## staging - 157 tests in 101 spec files

| spec | tests | red since | suggested owner |
|---|---|---|---|
| `../helpers/login-methods-otp.ts` | 1 | 2026-09-18 | e2e-tester (triage) |
| `../helpers/login-methods-suite.ts` | 2 | 2026-09-18 | e2e-tester (triage) |
| `a11y/a11y.spec.ts` | 3 | 2026-09-18 | e2e-tester (triage) |
| `agora/agora-admin.ui.spec.ts` | 6 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-api.spec.ts` | 4 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-billing.spec.ts` | 4 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-billing.ui.spec.ts` | 2 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-merchant-crud.spec.ts` | 9 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-onboarding.spec.ts` | 2 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-onboarding.ui.spec.ts` | 2 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-order-isolation.spec.ts` | 1 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-orders.spec.ts` | 1 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-orders.ui.spec.ts` | 3 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-tenant-isolation.spec.ts` | 1 | 2026-09-18 | frontend-dev (agora-web) |
| `i18n/fleet-raw-keys.ui.spec.ts` | 3 | 2026-09-18 | e2e-tester (triage) |
| `ichnos/ichnos-alert-delivery.spec.ts` | 1 | 2026-09-18 | backend-dev (ichnos) |
| `ichnos/ichnos-monitoring.spec.ts` | 1 | 2026-09-18 | backend-dev (ichnos) |
| `ichnos/ichnos-onboarding.spec.ts` | 2 | 2026-09-18 | backend-dev (ichnos) |
| `ichnos/ichnos-regulator-pack.spec.ts` | 1 | 2026-09-18 | backend-dev (ichnos) |
| `ichnos/ichnos-screening.spec.ts` | 1 | 2026-09-18 | backend-dev (ichnos) |
| `ichnos/ichnos-webhooks.spec.ts` | 1 | 2026-09-18 | backend-dev (ichnos) |
| `identity/login.spec.ts` | 6 | 2026-09-18 | backend-dev (auth / keycloak) |
| `identity/logout.spec.ts` | 1 | 2026-09-18 | backend-dev (auth / keycloak) |
| `identity/sec2-front-channel-logout.spec.ts` | 6 | 2026-09-18 | backend-dev (auth / keycloak) |
| `identity/token-refresh.spec.ts` | 1 | 2026-09-18 | backend-dev (auth / keycloak) |
| `kefi-landing-parity/dom-parity.spec.ts` | 6 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-attendee-delete.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-attendee-import.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-attendee-payment.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-backoffice-approval.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-crew-lifecycle.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-critical-path.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-custom-domain.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-device-pin-unlock.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-email-lifecycle.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-free-publish.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-gdpr.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-multi-event-publish.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-organizer-pnl.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-passkey-login.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-poster-passes-render.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-pro-gates-api.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-pro-gates-ui.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-pro-gates.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-qr-checkin.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-registration-approval.spec.ts` | 1 | 2026-09-19 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-reset-revokes-devices.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-role-surfaces.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-tenant-lifecycle.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `logging/correlation-tracking.spec.ts` | 3 | 2026-09-18 | e2e-tester (triage) |
| `logging/log-verification.spec.ts` | 2 | 2026-09-18 | e2e-tester (triage) |
| `menu-styling/menu-theme-swatch.spec.ts` | 1 | 2026-09-18 | e2e-tester (triage) |
| `online-menus/bff-no-token-in-browser.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/logout-kills-server-session.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-activation.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-content-upload-advanced.spec.ts` | 2 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-content-upload-basic.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-content-upload-create.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-crud-with-activation.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-display-order-sorting.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-duplicate-names.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-editor-categories-crud.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-editor-categories-focus.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-editor-categories-switching.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-preview-and-external-link.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-public-anon-cold-load.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-public-page-load-basic.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-public-page-load-viewer.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `online-menus/menu-qr-code.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `poueni/poueni-canary-cleanup.spec.ts` | 1 | 2026-09-18 | backend-dev (poueni) |
| `poueni/poueni-device-pin.spec.ts` | 1 | 2026-09-18 | backend-dev (poueni) |
| `poueni/poueni-gdpr.spec.ts` | 1 | 2026-09-18 | backend-dev (poueni) |
| `poueni/poueni-live-map.spec.ts` | 1 | 2026-09-18 | backend-dev (poueni) |
| `poueni/poueni-passkey.spec.ts` | 1 | 2026-09-19 | backend-dev (poueni) |
| `poueni/poueni-password-reset.spec.ts` | 1 | 2026-09-18 | backend-dev (poueni) |
| `prod-gate/erevna-login-layout.spec.ts` | 1 | 2026-09-18 | frontend-dev (per product) |
| `prod-gate/katalogos-menu-golden-path.spec.ts` | 1 | 2026-09-18 | frontend-dev (per product) |
| `prod-gate/katalogos-signup.spec.ts` | 3 | 2026-09-18 | frontend-dev (per product) |
| `prod-gate/kefi-event-golden-path.spec.ts` | 2 | 2026-09-18 | frontend-dev (per product) |
| `prod-gate/prod-login-gate.spec.ts` | 2 | 2026-09-18 | frontend-dev (per product) |
| `questioner/marketing/campaign-send.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/public/survey-embed-framing.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/quiz-active/quiz-multipage-navigation.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/quiz-active/quiz-multipage-validation.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/quiz-active/submit-quiz.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/quiz-answers/quiz-answers-export-filter.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/quiz-answers/view-answers.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/security/bff-no-token-in-browser.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/security/logout-kills-server-session.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/templates/activate-template.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/templates/active-quiz-limit.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/templates/create-template.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/templates/delete-inactive-templates.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `questioner/templates/edit-template.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `smoke/critical-paths.spec.ts` | 1 | 2026-09-18 | e2e-tester (triage) |
| `theme/theme-settings.spec.ts` | 1 | 2026-09-18 | e2e-tester (triage) |
| `zygos/zygos-console.ui.spec.ts` | 2 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-form-fields.ui.spec.ts` | 3 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-i18n.ui.spec.ts` | 1 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-public-surface.spec.ts` | 1 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-pwa.spec.ts` | 1 | 2026-09-18 | frontend-dev (zygos-web) |

## prod - 45 tests in 28 spec files

| spec | tests | red since | suggested owner |
|---|---|---|---|
| `agora/agora-admin.ui.spec.ts` | 6 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-billing.ui.spec.ts` | 2 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-onboarding.ui.spec.ts` | 2 | 2026-09-18 | frontend-dev (agora-web) |
| `agora/agora-orders.ui.spec.ts` | 3 | 2026-09-18 | frontend-dev (agora-web) |
| `i18n/fleet-raw-keys.ui.spec.ts` | 1 | 2026-09-18 | e2e-tester (triage) |
| `kefi-landing-parity/dom-parity.spec.ts` | 6 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-attendee-delete.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-attendee-import.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-attendee-payment.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-backoffice-approval.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-crew-lifecycle.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-critical-path.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-custom-domain.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-gdpr.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-multi-event-publish.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-organizer-pnl.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-pro-gates-api.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-registration-approval.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `kefi/kefi-role-surfaces.spec.ts` | 1 | 2026-09-18 | frontend-dev (kefi-web) / backend-dev (kefi) |
| `logging/log-verification.spec.ts` | 1 | 2026-09-18 | e2e-tester (triage) |
| `online-menus/menu-duplicate-names.spec.ts` | 1 | 2026-09-18 | frontend-dev (katalogos-web) |
| `questioner/public/survey-embed-framing.spec.ts` | 1 | 2026-09-18 | frontend-dev (erevna-web) |
| `smoke/critical-paths.spec.ts` | 1 | 2026-09-18 | e2e-tester (triage) |
| `zygos/zygos-console.ui.spec.ts` | 2 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-form-fields.ui.spec.ts` | 3 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-i18n.ui.spec.ts` | 1 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-public-surface.spec.ts` | 1 | 2026-09-18 | frontend-dev (zygos-web) |
| `zygos/zygos-pwa.spec.ts` | 1 | 2026-09-18 | frontend-dev (zygos-web) |

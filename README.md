# E2E Tests - Playwright Testing Service

End-to-end testing suite for the OnlineMenu SaaS microservices using Playwright.

- [E2E Tests - Playwright Testing Service](#e2e-tests---playwright-testing-service)
  - [Overview](#overview)
  - [Project Structure](#project-structure)
  - [Prerequisites](#prerequisites)
  - [Quick Start](#quick-start)
    - [1. Install Dependencies](#1-install-dependencies)
    - [2. Configure Environment](#2-configure-environment)
    - [3. Start Backend Services](#3-start-backend-services)
    - [4. Run Tests](#4-run-tests)
  - [NPM Scripts](#npm-scripts)
  - [Running with Docker](#running-with-docker)
    - [Docker Commands](#docker-commands)
  - [Test Coverage](#test-coverage)
    - [IdentityService Tests](#identityservice-tests)
    - [QuestionerService Tests](#questionerservice-tests)
    - [Smoke Tests](#smoke-tests)
  - [Writing New Tests](#writing-new-tests)
    - [Using Page Objects](#using-page-objects)
    - [Using Auth Helper](#using-auth-helper)
    - [Test Tags](#test-tags)
  - [Troubleshooting](#troubleshooting)
    - [Tests fail with "Test credentials not configured"](#tests-fail-with-test-credentials-not-configured)
    - [Tests fail with connection errors](#tests-fail-with-connection-errors)
    - [Tests timeout on login](#tests-timeout-on-login)
    - [Browser not found](#browser-not-found)
  - [CI/CD Integration (Future)](#cicd-integration-future)
  - [Related Documentation](#related-documentation)


## Overview

This is a centralized Playwright testing service that tests both the **IdentityService** and **QuestionerService** through the React Native/Expo frontend. The tests cover authentication flows, quiz template management, quiz completion, and answer viewing.

## Project Structure

```
E2ETests/
├── package.json                    # Dependencies & npm scripts
├── playwright.config.ts            # Playwright configuration
├── tsconfig.json                   # TypeScript config
├── .env.example                    # Environment template
├── .gitignore                      # Git ignores
├── Dockerfile                      # For containerized tests
│
├── fixtures/                       # Test fixtures
│   ├── auth.fixture.ts             # Extended test fixture with auth
│   ├── global-setup.ts             # Global authentication setup
│   └── index.ts
│
├── pages/                          # Page Object Models
│   ├── BasePage.ts                 # Base page class
│   ├── LoginPage.ts                # Login page interactions
│   ├── QuizTemplatesPage.ts        # Template CRUD operations
│   ├── QuizActivePage.ts           # Active quiz interactions
│   ├── QuizAnswersPage.ts          # Answer viewing
│   └── index.ts
│
├── helpers/                        # Utilities
│   ├── auth-helper.ts              # Direct API authentication
│   └── index.ts
│
├── tests/
│   ├── auth.setup.ts               # Authentication setup test
│   ├── identity/                   # IdentityService tests
│   │   ├── login.spec.ts           # Login flow tests
│   │   ├── logout.spec.ts          # Logout flow tests
│   │   └── token-refresh.spec.ts   # Token refresh tests
│   ├── questioner/                 # QuestionerService tests
│   │   ├── templates/              # Template CRUD tests
│   │   ├── quiz-active/            # Quiz filling tests
│   │   └── quiz-answers/           # Answer viewing tests
│   └── smoke/
│       └── critical-paths.spec.ts  # End-to-end smoke tests
│
└── reports/                        # Test reports (gitignored)
```

## Prerequisites

- Node.js 18+
- npm 8+
- Running backend services (or Docker)

## Quick Start

### 1. Install Dependencies

```bash
cd E2ETests
npm install
npx playwright install chromium
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your test credentials:

```env
# Application URLs
BASE_URL=http://localhost:8082
IDENTITY_API_URL=http://localhost:5002
QUESTIONER_API_URL=http://localhost:5004

# Test User Credentials (from Keycloak)
TEST_USER_USERNAME=your-test-user
TEST_USER_PASSWORD=your-test-password
```

### 3. Start Backend Services

Open separate terminals and start each service:

```bash
# Terminal 1: Start IdentityService
cd C:\desktopContents\projects\SaaS\IdentityService
docker-compose up

# Terminal 2: Start OnlineMenuService
cd C:\desktopContents\projects\SaaS\OnlineMenuSaaS\OnlineMenuService
docker-compose up

# Terminal 3: Start QuestionerService
cd C:\desktopContents\projects\SaaS\QuestionerService
docker-compose up

# Terminal 4: Start Frontend
cd C:\desktopContents\projects\SaaS\OnlineMenuSaaS\clients\OnlineMenuClientApp
npm run start:dev
```

### 4. Run Tests

```bash
cd E2ETests
npm test
```

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:debug` | Run tests in debug mode |
| `npm run test:ui` | Open Playwright UI |
| `npm run test:identity` | Run IdentityService tests only |
| `npm run test:questioner` | Run QuestionerService tests only |
| `npm run test:smoke` | Run smoke tests only |
| `npm run test:chrome` | Run tests in Chrome only |
| `npm run test:firefox` | Run tests in Firefox only |
| `npm run test:mobile` | Run tests in mobile viewport |
| `npm run report` | Open HTML test report |
| `npm run codegen` | Open Playwright codegen tool |

## Running with Docker

To run the entire stack (all services + tests) in Docker:

```bash
cd C:\desktopContents\projects\SaaS
docker compose -f docker-compose.e2e.yml up --build
```

This will:
1. Start PostgreSQL databases for each service
2. Build and start IdentityService, QuestionerService, and OnlineMenuService
3. Build and start the frontend client
4. Run Playwright tests against the stack
5. Output test reports to `E2ETests/reports/`

### Docker Commands

```bash
# Start services in background
docker compose -f docker-compose.e2e.yml up -d --build

# Run tests only
docker compose -f docker-compose.e2e.yml up playwright

# View logs
docker compose -f docker-compose.e2e.yml logs -f

# Stop all services
docker compose -f docker-compose.e2e.yml down

# Clean up volumes
docker compose -f docker-compose.e2e.yml down -v
```

## Test Coverage

### IdentityService Tests

| Test File | Coverage |
|-----------|----------|
| `login.spec.ts` | Valid/invalid credentials, empty fields, form validation |
| `logout.spec.ts` | Logout flow, session clearing, redirect to login |
| `token-refresh.spec.ts` | Token refresh via API, session maintenance |

### QuestionerService Tests

| Test File | Coverage |
|-----------|----------|
| `create-template.spec.ts` | Create templates, validation, special characters |
| `edit-template.spec.ts` | Edit modal, update name/description, cancel |
| `activate-template.spec.ts` | Activate/deactivate templates |
| `fill-quiz.spec.ts` | Display quiz, navigate pages, validation |
| `submit-quiz.spec.ts` | Submit quiz, thank you message |
| `view-answers.spec.ts` | Search answers, view details, export |

### Smoke Tests

| Test | Description |
|------|-------------|
| Complete user journey | Login -> Create template -> Activate -> View answers |
| Navigation | Verify all protected pages accessible |
| API calls | Verify authenticated API calls work |
| CRUD operations | Full template create/update/delete cycle |
| Page refresh | Verify auth state persists |
| JavaScript errors | Check for console errors across pages |

## Writing New Tests

### Using Page Objects

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

test('should login successfully', async ({ page }) => {
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login('username', 'password');
  await loginPage.expectToBeOnProtectedRoute();
});
```

### Using Auth Helper

```typescript
import { AuthHelper } from '../../helpers/auth-helper.js';

test('should refresh token', async () => {
  const authHelper = new AuthHelper();

  await authHelper.loginViaAPI('username', 'password');
  const newTokens = await authHelper.refreshTokens();

  expect(newTokens.accessToken).toBeTruthy();
});
```

### Test Tags

Use tags to categorize tests:

```typescript
test('should login @identity @auth @critical', async ({ page }) => {
  // ...
});
```

Run tagged tests:

```bash
npx playwright test --grep @critical
npx playwright test --grep @identity
npx playwright test --grep @questioner
```

## Troubleshooting

### Tests fail with "Test credentials not configured"

Ensure `.env.local` exists with valid `TEST_USER_USERNAME` and `TEST_USER_PASSWORD`.

### Tests fail with connection errors

1. Verify all backend services are running
2. Check the URLs in `.env.local` match your services
3. Ensure Keycloak is accessible

### Tests timeout on login

1. Check IdentityService logs for errors
2. Verify Keycloak realm and client configuration
3. Try running tests in headed mode: `npm run test:headed`

### Browser not found

Run `npx playwright install` to install browsers.

## CI/CD Integration (Future)

GitHub Actions workflow example (to be added in `.github/workflows/e2e.yml`):

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        run: |
          cd E2ETests
          npm ci
          npx playwright install --with-deps chromium
      - name: Run tests
        run: |
          cd E2ETests
          npm run test:ci
        env:
          TEST_USER_USERNAME: ${{ secrets.TEST_USER_USERNAME }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: E2ETests/reports/
```

## Related Documentation

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [OnlineMenuSaaS README](../OnlineMenuSaaS/README.md)
- [IdentityService README](../IdentityService/README.md)
- [QuestionerService README](../QuestionerService/README.md)

# Playwright Best Practices

This document defines the standards for writing fast, robust, and maintainable E2E tests with Playwright.

## Table of Contents

- [Core Principles](#core-principles)
- [Locator Strategy](#locator-strategy)
- [Waiting Strategies](#waiting-strategies)
- [Navigation](#navigation)
- [Assertions](#assertions)
- [Page Objects](#page-objects)
- [Test Structure](#test-structure)
- [Performance Guidelines](#performance-guidelines)
- [Anti-Patterns](#anti-patterns)
- [Quick Reference](#quick-reference)

---

## Core Principles

### 1. Trust Playwright's Auto-Waiting

Playwright automatically waits for elements to be actionable before performing actions. Don't add manual waits unless absolutely necessary.

```typescript
// GOOD - Playwright auto-waits for element to be visible and enabled
await page.click('[data-testid="submit-button"]');

// BAD - Redundant manual wait
await page.waitForSelector('[data-testid="submit-button"]');
await page.click('[data-testid="submit-button"]');
```

### 2. Use Web-First Assertions

Web-first assertions automatically retry until the condition is met or timeout expires.

```typescript
// GOOD - Auto-retries until element is visible or timeout
await expect(page.locator('[data-testid="success-message"]')).toBeVisible();

// BAD - Single check, no retry
const isVisible = await page.locator('[data-testid="success-message"]').isVisible();
expect(isVisible).toBe(true);
```

### 3. Be Specific, Not Broad

Target exactly what you need. Avoid overly broad selectors that match multiple elements.

```typescript
// GOOD - Specific testId
page.locator('[data-testid="login-submit-button"]')

// BAD - Could match any button
page.locator('button')
```

---

## Locator Strategy

### Priority Order (Fastest to Slowest)

1. **`data-testid`** - Fastest, most reliable
2. **`getByRole`** - Semantic, accessibility-friendly
3. **`getByText`** - Good for unique text
4. **`getByPlaceholder`** - For input fields
5. **CSS selectors** - Last resort

### Recommended Patterns

```typescript
// 1. BEST - data-testid (instant lookup, stable)
page.locator('[data-testid="login-button"]')
// Or use the helper:
page.locator(testIdSelector(TestIds.LOGIN_BUTTON))

// 2. GOOD - getByRole (semantic, accessibility-friendly)
page.getByRole('button', { name: 'Submit' })

// 3. OK - getByText (for unique visible text)
page.getByText('Welcome back')

// 4. OK - getByPlaceholder (for inputs)
page.getByPlaceholder('Enter your email')

// 5. AVOID - Complex CSS selectors (brittle)
page.locator('.form-container > div:nth-child(2) button.primary')
```

### DO NOT Use

```typescript
// NEVER - XPath (slow, brittle)
page.locator('//div[@class="container"]//button')

// NEVER - .or() chains (doubles lookup time)
page.locator('[data-testid="btn"]').or(page.getByRole('button'))

// NEVER - Index-based selectors (brittle)
page.locator('button').nth(2)
```

### TestId Helper

Always use the shared `testIdSelector` helper for consistency:

```typescript
import { TestIds, testIdSelector } from '../shared/testIds.js';

// Generates: [data-testid="login-button"]
page.locator(testIdSelector(TestIds.LOGIN_BUTTON))
```

---

## Waiting Strategies

### What to Wait For

| Scenario | Wait Strategy |
|----------|--------------|
| Element appears | `await expect(locator).toBeVisible()` |
| Element disappears | `await expect(locator).not.toBeVisible()` |
| Text changes | `await expect(locator).toHaveText('new text')` |
| URL changes | `await expect(page).toHaveURL(/pattern/)` |
| API response | `await page.waitForResponse(r => r.url().includes('/api'))` |
| Multiple conditions | `await Promise.all([...])` |

### Correct Usage

```typescript
// Wait for element to appear
await expect(page.locator('[data-testid="success"]')).toBeVisible();

// Wait for element to disappear (loading states)
await expect(page.locator('[data-testid="loading"]')).not.toBeVisible();

// Wait for specific API response
const responsePromise = page.waitForResponse(
  r => r.url().includes('/api/templates') && r.request().method() === 'POST'
);
await page.click('[data-testid="save"]');
const response = await responsePromise;
expect(response.ok()).toBe(true);

// Wait for navigation
await Promise.all([
  page.waitForURL(/\/dashboard/),
  page.click('[data-testid="login-button"]'),
]);
```

### NEVER Use

```typescript
// NEVER - Arbitrary timeouts
await page.waitForTimeout(2000);

// NEVER - networkidle (waits 500ms after last request)
await page.waitForLoadState('networkidle');

// NEVER - Fixed sleep
await new Promise(r => setTimeout(r, 1000));
```

### If You Think You Need waitForTimeout

If you're tempted to use `waitForTimeout`, ask yourself:

1. **What am I waiting for?** - Identify the specific condition
2. **Can I wait for an element?** - Use `expect(locator).toBeVisible()`
3. **Can I wait for an API?** - Use `waitForResponse()`
4. **Can I wait for a URL?** - Use `expect(page).toHaveURL()`
5. **Is there a race condition?** - Fix the test setup, don't mask it

---

## Navigation

### Fast Navigation

```typescript
// GOOD - 'commit' is fastest, let assertions wait for elements
await page.goto('/dashboard', { waitUntil: 'commit' });
await expect(page.locator('[data-testid="dashboard"]')).toBeVisible();

// OK - 'domcontentloaded' for complex pages
await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

// AVOID - 'load' waits for all resources (slow)
await page.goto('/dashboard', { waitUntil: 'load' });

// NEVER - 'networkidle' (slowest)
await page.goto('/dashboard', { waitUntil: 'networkidle' });
```

### Navigation Wait Strategy

| `waitUntil` | What It Waits For | When to Use |
|-------------|-------------------|-------------|
| `'commit'` | Response received | Default choice, fastest |
| `'domcontentloaded'` | DOM parsed | Complex SPAs |
| `'load'` | All resources loaded | Never in E2E |
| `'networkidle'` | 500ms no network | Never in E2E |

### Parallel Navigation Patterns

```typescript
// Wait for navigation + API response together
await Promise.all([
  page.waitForResponse(r => r.url().includes('/api/user')),
  page.goto('/profile'),
]);
```

---

## Assertions

### Prefer Web-First Assertions

```typescript
// GOOD - Auto-retries until true or timeout
await expect(page.locator('[data-testid="message"]')).toBeVisible();
await expect(page.locator('[data-testid="count"]')).toHaveText('5');
await expect(page).toHaveURL(/\/success/);

// BAD - No auto-retry
const text = await page.locator('[data-testid="count"]').textContent();
expect(text).toBe('5');
```

### Assertion Cheat Sheet

| Check | Assertion |
|-------|-----------|
| Element visible | `await expect(locator).toBeVisible()` |
| Element hidden | `await expect(locator).not.toBeVisible()` |
| Element has text | `await expect(locator).toHaveText('exact')` |
| Element contains text | `await expect(locator).toContainText('partial')` |
| Element has value | `await expect(locator).toHaveValue('value')` |
| Element enabled | `await expect(locator).toBeEnabled()` |
| Element disabled | `await expect(locator).toBeDisabled()` |
| Element checked | `await expect(locator).toBeChecked()` |
| Element count | `await expect(locator).toHaveCount(3)` |
| URL matches | `await expect(page).toHaveURL(/pattern/)` |
| Title matches | `await expect(page).toHaveTitle('Title')` |

### Custom Timeouts

Only increase timeouts when there's a legitimate reason:

```typescript
// Default timeout (5s) - use for most assertions
await expect(locator).toBeVisible();

// Extended timeout - only for slow operations
await expect(locator).toBeVisible({ timeout: 10000 });

// Global timeout configuration in playwright.config.ts is preferred
```

---

## Page Objects

### Structure

```typescript
import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

export class LoginPage extends BasePage {
  // Declare locators as readonly properties
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    // Initialize locators in constructor - use testId only
    this.usernameInput = page.locator(testIdSelector(TestIds.USERNAME_INPUT));
    this.passwordInput = page.locator(testIdSelector(TestIds.PASSWORD_INPUT));
    this.submitButton = page.locator(testIdSelector(TestIds.LOGIN_BUTTON));
    this.errorMessage = page.locator(testIdSelector(TestIds.ERROR_MESSAGE));
  }

  // Navigation methods
  async goto() {
    await this.page.goto('/login', { waitUntil: 'commit' });
  }

  // Action methods - return void or Promise<void>
  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  // Assertion methods - prefix with 'expect'
  async expectLoggedIn() {
    await expect(this.page).not.toHaveURL(/\/login/);
  }

  async expectError(message: string) {
    await expect(this.errorMessage).toContainText(message);
  }
}
```

### Guidelines

1. **Locators in constructor** - Initialize all locators in constructor, not in methods
2. **testId only** - Don't use fallback `.or()` chains
3. **Action methods** - Return `Promise<void>`, let caller decide what to assert
4. **Assertion methods** - Prefix with `expect`, contain the full assertion
5. **No internal waits** - Don't add `waitForTimeout` inside page objects

---

## Test Structure

### Basic Test Template

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

test.describe('Login Flow', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('should login with valid credentials', async () => {
    await loginPage.login('user', 'password');
    await loginPage.expectLoggedIn();
  });

  test('should show error with invalid credentials', async () => {
    await loginPage.login('invalid', 'invalid');
    await loginPage.expectError('Invalid credentials');
  });
});
```

### Test Independence

Each test must be completely independent:

```typescript
// GOOD - Test sets up its own state
test('should delete template', async ({ page }) => {
  const templatesPage = new TemplatesPage(page);

  // Create template for this test
  await templatesPage.createTemplate('Test Template');

  // Now delete it
  await templatesPage.deleteTemplate('Test Template');

  // Verify
  await templatesPage.expectTemplateNotExists('Test Template');
});

// BAD - Depends on previous test
test('should delete template', async ({ page }) => {
  // Assumes template exists from previous test - WRONG
  await templatesPage.deleteTemplate('Test Template');
});
```

### Parallel-Safe Tests

```typescript
// GOOD - Uses unique identifiers
test('should create template', async () => {
  const uniqueName = `Template ${Date.now()}`;
  await templatesPage.createTemplate(uniqueName);
  await templatesPage.expectTemplateExists(uniqueName);
  // Cleanup
  await templatesPage.deleteTemplate(uniqueName);
});

// BAD - Uses fixed name that conflicts in parallel runs
test('should create template', async () => {
  await templatesPage.createTemplate('My Template'); // Will conflict!
});
```

---

## Performance Guidelines

### Target Metrics

| Test Type | Target Duration |
|-----------|-----------------|
| Simple UI check | < 500ms |
| Form submission | < 800ms |
| CRUD operation | < 1s |
| Multi-step flow | < 2s |

### Optimization Checklist

- [ ] Use `data-testid` locators (fastest)
- [ ] Use `waitUntil: 'commit'` for navigation
- [ ] No `waitForTimeout()` calls
- [ ] No `networkidle` waits
- [ ] No `.or()` locator chains
- [ ] Wait for specific conditions, not arbitrary time
- [ ] Run independent setup steps in parallel with `Promise.all`

### Parallel Operations

```typescript
// GOOD - Parallel waits for independent conditions
await Promise.all([
  expect(page.locator('[data-testid="header"]')).toBeVisible(),
  expect(page.locator('[data-testid="sidebar"]')).toBeVisible(),
  expect(page.locator('[data-testid="content"]')).toBeVisible(),
]);

// BAD - Sequential waits (3x slower)
await expect(page.locator('[data-testid="header"]')).toBeVisible();
await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
await expect(page.locator('[data-testid="content"]')).toBeVisible();
```

---

## Anti-Patterns

### 1. Arbitrary Timeouts

```typescript
// NEVER
await page.waitForTimeout(2000);
await new Promise(r => setTimeout(r, 1000));

// INSTEAD - Wait for specific condition
await expect(locator).toBeVisible();
await page.waitForResponse(r => r.url().includes('/api'));
```

### 2. Network Idle

```typescript
// NEVER
await page.waitForLoadState('networkidle');
await page.goto('/page', { waitUntil: 'networkidle' });

// INSTEAD - Wait for specific element or API
await page.goto('/page', { waitUntil: 'commit' });
await expect(page.locator('[data-testid="content"]')).toBeVisible();
```

### 3. Checking Visibility Before Assertion

```typescript
// BAD - Redundant visibility check
if (await locator.isVisible()) {
  await expect(locator).toBeVisible();
}

// GOOD - Just assert
await expect(locator).toBeVisible();
```

### 4. Long Timeout Checks for Non-Existent Elements

```typescript
// BAD - Waits full timeout if element doesn't exist
if (await element.isVisible({ timeout: 5000 }).catch(() => false)) {
  await element.click();
}

// GOOD - Use count() which is instant
if (await element.count() > 0) {
  await element.click();
}
```

### 5. Fallback Locator Chains

```typescript
// BAD - Doubles lookup time
const button = page.locator('[data-testid="btn"]')
  .or(page.getByRole('button', { name: 'Submit' }));

// GOOD - Single, reliable locator
const button = page.locator('[data-testid="btn"]');
```

### 6. Page Reload to Refresh State

```typescript
// BAD - Slow, loses React state
await page.reload();

// GOOD - Wait for React to update
await expect(locator).toHaveText('Updated Value');
// Or trigger a refresh action
await page.click('[data-testid="refresh"]');
await page.waitForResponse(r => r.url().includes('/api/data'));
```

---

## Quick Reference

### Fast Patterns

```typescript
// Navigation
await page.goto('/path', { waitUntil: 'commit' });

// Click and wait for response
const response = page.waitForResponse(r => r.url().includes('/api'));
await page.click('[data-testid="submit"]');
await response;

// Check element exists (instant)
if (await element.count() > 0) { ... }

// Parallel assertions
await Promise.all([
  expect(a).toBeVisible(),
  expect(b).toBeVisible(),
]);

// Web-first assertions
await expect(locator).toBeVisible();
await expect(locator).toHaveText('text');
await expect(page).toHaveURL(/pattern/);
```

### Slow Patterns (Avoid)

```typescript
// DON'T: Arbitrary waits
await page.waitForTimeout(1000);

// DON'T: Network idle
await page.waitForLoadState('networkidle');

// DON'T: Timeout-based visibility checks
await element.isVisible({ timeout: 5000 });

// DON'T: Fallback locators
locator.or(otherLocator);

// DON'T: Page reload for state refresh
await page.reload();
```

---

## Further Reading

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Locators Guide](https://playwright.dev/docs/locators)
- [Auto-Waiting](https://playwright.dev/docs/actionability)
- [Web-First Assertions](https://playwright.dev/docs/test-assertions)

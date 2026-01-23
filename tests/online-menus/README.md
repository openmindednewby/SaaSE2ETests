# Online Menu Management E2E Tests

This directory contains end-to-end tests for the Online Menu Management feature using Playwright.

## Test Suites

### menu-activation.spec.ts
Tests the core activation and deactivation functionality introduced in Backend Phase 1.

**What it tests**:
- Creating menus for activation tests
- Activating a menu via PATCH /TenantMenus/{id}/activate
- Deactivating a menu via PATCH /TenantMenus/{id}/deactivate
- Status badge updates after activation/deactivation
- Re-activating previously deactivated menus
- Multiple activation/deactivation cycles

**API Endpoints Tested**:
- `POST /TenantMenus` (menu creation)
- `PATCH /TenantMenus/{externalId}/activate`
- `PATCH /TenantMenus/{externalId}/deactivate`
- `GET /TenantMenus` (menu list refresh)

**Critical Tests** (tagged @critical):
- Should activate a menu

### menu-status-display.spec.ts
Tests that the `isActive` field displays correctly across various scenarios.

**What it tests**:
- Default status for newly created menus (should be inactive)
- Independent status display for multiple menus
- Immediate status updates after activation/deactivation
- Status persistence after page reload
- Mixed active/inactive states across multiple menus
- Status consistency during rapid changes

**UI Elements Tested**:
- Menu list rendering
- Status badge display
- Status text content
- Real-time status updates

**Critical Tests** (tagged @critical):
- Should show newly created menus as inactive by default
- Should persist status after page reload

### menu-crud-with-activation.spec.ts
Tests the integration of CRUD operations with activation state management.

**What it tests**:
- Creating menus (should start inactive)
- Activating newly created menus
- Deleting active menus
- Deleting inactive menus
- Listing menus with correct activation states
- State management during CRUD operations

**Critical Tests** (tagged @critical):
- Should create menu with inactive status by default

## Running the Tests

### Run all online menu tests
```bash
cd E2ETests
npx playwright test tests/online-menus
```

### Run specific test file
```bash
npx playwright test tests/online-menus/menu-activation.spec.ts
```

### Run only critical tests
```bash
npx playwright test tests/online-menus --grep @critical
```

### Run with UI mode (for debugging)
```bash
npx playwright test tests/online-menus --ui
```

### Run with trace (for detailed debugging)
```bash
npx playwright test tests/online-menus --trace on
```

## Test Data

Tests use unique timestamps in menu names to ensure test isolation:
- `Activation Test Menu ${Date.now()}`
- `Status Test Menu 1 ${Date.now()}`
- `CRUD Test Menu ${Date.now()}`

This ensures tests can run in parallel without conflicts.

## Page Objects

Tests use the `OnlineMenusPage` page object located at `E2ETests/pages/OnlineMenusPage.ts`.

**Key methods**:
- `goto()` - Navigate to online menus page
- `createMenu(name, description)` - Create a new menu
- `activateMenu(name)` - Activate a menu
- `deactivateMenu(name)` - Deactivate a menu
- `deleteMenu(name)` - Delete a menu
- `expectMenuActive(name, active)` - Assert menu activation status
- `getMenuStatus(name)` - Get menu status text
- `menuExists(name)` - Check if menu exists

## TestIds Used

All tests use the following testIds from `E2ETests/shared/testIds.ts`:
- `MENU_LIST` - The menu list container
- `MENU_CARD` - Individual menu cards
- `MENU_CARD_NAME` - Menu name display
- `MENU_CARD_STATUS_BADGE` - Status badge (Active/Inactive)
- `MENU_CARD_ACTIVATE_BUTTON` - Activate button
- `MENU_CARD_DEACTIVATE_BUTTON` - Deactivate button
- `MENU_CARD_EDIT_BUTTON` - Edit button
- `MENU_CARD_DELETE_BUTTON` - Delete button
- `MENU_EDITOR` - Menu editor modal
- `MENU_EDITOR_NAME_INPUT` - Name input field
- `MENU_EDITOR_DESCRIPTION_INPUT` - Description input field
- `MENU_EDITOR_SAVE_BUTTON` - Save button
- `MENU_EDITOR_CANCEL_BUTTON` - Cancel button

## Playwright Best Practices

These tests follow the best practices documented in `E2ETests/docs/playwright-best-practices.md`:

✅ **Web-first assertions** - All assertions use `expect(locator).toBeVisible()` pattern
✅ **No waitForTimeout** - Tests wait for specific conditions, not arbitrary time
✅ **testId selectors** - All elements located using data-testid attributes
✅ **Page Object Model** - Tests use page objects for maintainability
✅ **Test isolation** - Each test can run independently
✅ **Proper cleanup** - afterAll hooks clean up test data
✅ **Serial execution** - Tests share browser context for speed
✅ **API response waiting** - Tests explicitly wait for API calls to complete

## Prerequisites

Before running these tests, ensure:
1. Backend Phase 1 is deployed with activate/deactivate endpoints
2. Frontend has implemented the menu UI with required testIds
3. React Query hooks are integrated for activation/deactivation
4. Test user credentials are configured in `E2ETests/fixtures/test-data.ts`

## Troubleshooting

### Tests fail with "Menu not found"
- Check that frontend has implemented menu cards with `MENU_CARD` testId
- Verify menu names are displayed with `MENU_CARD_NAME` testId

### Tests fail with "Activate button not found"
- Check that activate/deactivate buttons are implemented
- Verify buttons use `MENU_CARD_ACTIVATE_BUTTON` and `MENU_CARD_DEACTIVATE_BUTTON` testIds

### Tests timeout waiting for API response
- Check that backend endpoints are deployed: `/TenantMenus/{id}/activate` and `/TenantMenus/{id}/deactivate`
- Verify React Query hooks are calling the correct endpoints
- Check network tab in Playwright trace to see actual API calls

### Status doesn't update after activation
- Check that frontend updates the UI after successful API response
- Verify React Query cache invalidation is working
- Check that status badge uses `MENU_CARD_STATUS_BADGE` testId

## Future Enhancements

Additional tests to add when features are implemented:
- [ ] Drag-and-drop menu ordering tests (using `displayOrder` field)
- [ ] Drag-and-drop category ordering tests
- [ ] Drag-and-drop menu item ordering tests
- [ ] Public menu viewer filtering by `isActive`
- [ ] Multi-user activation conflict tests
- [ ] Menu preview tests
- [ ] Theme customization tests

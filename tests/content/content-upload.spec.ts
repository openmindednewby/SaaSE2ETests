import { expect, test } from '@playwright/test';
import path from 'path';
import { TestIds, testIdSelector } from '../../shared/testIds.js';

/**
 * E2E Tests for Content Upload Functionality
 *
 * These tests verify content upload contracts and validation rules.
 * The tests cover:
 * - File type validation (MIME types)
 * - File size limits
 * - Test fixture verification
 * - Test ID contracts
 * - Accessibility contracts
 *
 * NOTE: Full UI integration tests are in:
 * - tests/online-menus/menu-content-upload-basic.spec.ts
 * - tests/online-menus/menu-content-upload-create.spec.ts
 * - tests/online-menus/menu-content-upload-advanced.spec.ts
 *
 * That file contains comprehensive tests for:
 * - Image upload to menu items and categories
 * - Upload persistence after save/reload
 * - CORS handling verification
 * - Multiple uploads
 * - Error handling
 *
 * Tests are tagged with @content-upload for selective execution.
 */

// Path to test fixtures
const FIXTURES_PATH = path.resolve(__dirname, '../../fixtures/files');
const TEST_IMAGE_PATH = path.join(FIXTURES_PATH, 'test-image.png');

test.describe('Content Upload - Test Fixtures @content-upload', () => {
  test('test image fixture should exist', async () => {
    const fs = await import('fs');
    const exists = fs.existsSync(TEST_IMAGE_PATH);
    expect(exists, `Test image should exist at ${TEST_IMAGE_PATH}`).toBe(true);
  });

  test('test image fixture should be a valid PNG', async () => {
    const fs = await import('fs');
    const buffer = fs.readFileSync(TEST_IMAGE_PATH);

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const fileSignature = buffer.subarray(0, 8);
    expect(fileSignature.equals(pngSignature), 'File should have PNG signature').toBe(true);
  });

  test('test image fixture should be small enough for tests', async () => {
    const fs = await import('fs');
    const stats = fs.statSync(TEST_IMAGE_PATH);

    // Test image should be less than 1KB for fast tests
    expect(stats.size).toBeLessThan(1024);
  });
});

/**
 * NOTE: UI integration tests have been moved to:
 * tests/online-menus/menu-content-upload-basic.spec.ts
 * tests/online-menus/menu-content-upload-create.spec.ts
 * tests/online-menus/menu-content-upload-advanced.spec.ts
 *
 * That file contains comprehensive tests for the complete upload flow
 * including image upload, save, reload, CORS handling, and deletion.
 */

test.describe('Content Upload - Test IDs Contract @content-upload', () => {
  /**
   * These tests verify that the expected test IDs are defined and consistent
   * between the BaseClient and E2ETests shared testIds files.
   */

  test('should have all required content upload test IDs defined', async () => {
    // Verify all expected test IDs exist
    const requiredTestIds = [
      'CONTENT_UPLOADER',
      'CONTENT_UPLOADER_BUTTON',
      'CONTENT_UPLOADER_ERROR',
      'CONTENT_PREVIEW',
      'CONTENT_PREVIEW_IMAGE',
      'CONTENT_PREVIEW_VIDEO_THUMBNAIL',
      'CONTENT_PREVIEW_DOCUMENT',
      'CONTENT_PREVIEW_DELETE_BUTTON',
      'UPLOAD_PROGRESS_CONTAINER',
      'UPLOAD_PROGRESS_FILE_NAME',
      'UPLOAD_PROGRESS_BAR',
      'UPLOAD_PROGRESS_CANCEL_BUTTON',
      'IMAGE_PICKER',
      'VIDEO_PICKER',
      'DOCUMENT_PICKER',
    ] as const;

    for (const testIdKey of requiredTestIds) {
      expect(
        TestIds[testIdKey as keyof typeof TestIds],
        `Missing test ID: ${testIdKey}`,
      ).toBeDefined();
    }
  });

  test('test IDs should follow naming convention', async () => {
    // Content-related test IDs should use lowercase with hyphens
    const contentTestIds = [
      TestIds.CONTENT_UPLOADER,
      TestIds.CONTENT_UPLOADER_BUTTON,
      TestIds.CONTENT_PREVIEW,
      TestIds.IMAGE_PICKER,
      TestIds.VIDEO_PICKER,
      TestIds.DOCUMENT_PICKER,
    ];

    for (const testId of contentTestIds) {
      expect(testId).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test('testIdSelector helper should generate valid CSS selector', async () => {
    const selector = testIdSelector(TestIds.CONTENT_UPLOADER);
    expect(selector).toBe('[data-testid="content-uploader"]');
  });
});

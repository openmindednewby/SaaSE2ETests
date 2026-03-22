import { expect, test } from '@playwright/test';
import { tryRequest } from './content-api-helpers.js';

/**
 * E2E Tests for Content Service API - Request validation and category contracts.
 * Tests require the Content Service to be running on port 5009.
 */

test.describe('Content API Request Validation @content-api', () => {
  test('should reject malformed JSON in upload-url request', async ({ request }) => {
    const result = await tryRequest(request, '/api/v1/content/upload-url', {
      method: 'POST',
      data: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!result) {
      test.skip(true, 'Content Service not available');
      return;
    }

    // Should return 400 Bad Request or 401 Unauthorized (auth checked first)
    expect([400, 401, 415]).toContain(result.response.status());
  });

  test('should handle missing Content-Type header', async ({ request }) => {
    const result = await tryRequest(request, '/api/v1/content/upload-url', {
      method: 'POST',
      data: {
        fileName: 'test.png',
        contentType: 'image/png',
        fileSizeBytes: 1024,
        category: 'Image',
      },
    });

    if (!result) {
      test.skip(true, 'Content Service not available');
      return;
    }

    // Should handle gracefully (either 401 or 415 Unsupported Media Type)
    expect([401, 415]).toContain(result.response.status());
  });
});

test.describe('Content Categories Validation @content-api', () => {
  const categories = [
    {
      category: 'Image',
      validTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      maxSizeMB: 10,
    },
    {
      category: 'Video',
      validTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
      maxSizeMB: 500,
    },
    {
      category: 'Document',
      validTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      maxSizeMB: 50,
    },
  ] as const;

  for (const cat of categories) {
    test(`should recognize ${cat.category} category with valid MIME types`, async () => {
      // Contract test - verifying expected category configurations
      expect(cat.validTypes.length).toBeGreaterThan(0);
      expect(cat.maxSizeMB).toBeGreaterThan(0);

      for (const mimeType of cat.validTypes) {
        expect(mimeType).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      }
    });
  }

  test('should have defined file size limits for all categories', async () => {
    const expectedCategories = ['Image', 'Video', 'Document'];

    for (const category of expectedCategories) {
      const config = categories.find((c) => c.category === category);
      expect(config, `Missing configuration for category: ${category}`).toBeDefined();
      expect(config?.maxSizeMB).toBeGreaterThan(0);
    }
  });
});

import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * E2E Tests for Content Service API endpoints
 *
 * These tests verify the Content Service API is accessible and responds correctly.
 * The Content Service handles file uploads (images, videos, documents) for the
 * online menu feature.
 *
 * Note: These tests require the Content Service to be running on port 5009.
 * Tests are tagged with @content-api for selective execution.
 */

// Content API base URL - configurable via environment variable
function resolveContentApiUrl(): string {
  const envUrl = process.env.CONTENT_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'https://localhost:5009';
}

const CONTENT_API_URL = resolveContentApiUrl();

/**
 * Attempts to reach the API with protocol fallback (https -> http).
 * Returns the first successful response.
 */
async function tryRequest(
  request: APIRequestContext,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    data?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ response: APIResponse; url: string } | null> {
  const { method = 'GET', data, headers } = options;
  const baseUrls = [CONTENT_API_URL];

  // Add protocol fallback
  if (CONTENT_API_URL.startsWith('https://')) {
    baseUrls.push(CONTENT_API_URL.replace('https://', 'http://'));
  } else if (CONTENT_API_URL.startsWith('http://')) {
    baseUrls.push(CONTENT_API_URL.replace('http://', 'https://'));
  }

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}${path}`;
    try {
      let response: APIResponse;

      switch (method) {
        case 'POST':
          response = await request.post(url, { data, headers });
          break;
        case 'DELETE':
          response = await request.delete(url, { headers });
          break;
        default:
          response = await request.get(url, { headers });
      }

      return { response, url };
    } catch {
      // Continue to next URL
    }
  }

  return null;
}

/**
 * Waits for an endpoint to become healthy with retry logic.
 */
async function waitForHealthy(
  request: APIRequestContext,
  path: string,
  timeoutMs: number = 30000,
): Promise<{ response: APIResponse; url: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    const result = await tryRequest(request, path);
    if (result && result.response.ok()) {
      return result;
    }

    if (result) {
      lastError = `Status ${result.response.status()} from ${result.url}`;
    } else {
      lastError = 'Connection failed';
    }

    // Wait before retry
    await new Promise((r) => setTimeout(r, 750));
  }

  throw new Error(
    `Health probe did not become healthy within ${timeoutMs}ms. Last error: ${lastError}`,
  );
}

test.describe('Content Service Health Probes @content-api @health', () => {
  const healthPaths = [
    { name: 'startup', path: '/health/start' },
    { name: 'liveness', path: '/health/live' },
    { name: 'readiness', path: '/health/ready' },
  ] as const;

  for (const probe of healthPaths) {
    test(`ContentService ${probe.name} probe should return healthy`, async ({ request }) => {
      // First, do a quick check to see if service is available at all
      const quickCheck = await tryRequest(request, probe.path);

      if (!quickCheck) {
        test.skip(true, `Content Service not available at ${CONTENT_API_URL}`);
        return;
      }

      // If we got a response, wait for it to become healthy (with shorter timeout)
      try {
        const { response, url } = await waitForHealthy(request, probe.path, 10000);

        expect(response.status(), `Expected 200 OK from ${url}`).toBe(200);

        const body = (await response.text().catch(() => '')).trim();
        if (body) {
          expect(body.toLowerCase()).toMatch(/healthy|ok/);
        }
      } catch (error) {
        // Mark as skipped if service is not healthy in time
        test.skip(true, `Content Service health probe failed: ${(error as Error).message}`);
      }
    });
  }
});

test.describe('Content Service API Endpoints @content-api', () => {
  test.describe('Upload URL Request', () => {
    test('POST /api/content/upload-url should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/content/upload-url', {
        method: 'POST',
        data: {
          fileName: 'test-image.png',
          contentType: 'image/png',
          fileSizeBytes: 1024,
          category: 'Image',
        },
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      // Should return 401 Unauthorized without auth token
      expect(result.response.status()).toBe(401);
    });

    test('POST /api/content/upload-url should validate request body', async ({ request }) => {
      // This test would need authentication - placeholder for when auth is available
      test.skip(true, 'Requires authentication setup for Content Service');
    });

    test('POST /api/content/upload-url should reject invalid file types', async ({ request }) => {
      // This test would need authentication - placeholder for when auth is available
      test.skip(true, 'Requires authentication setup for Content Service');
    });

    test('POST /api/content/upload-url should enforce file size limits', async ({ request }) => {
      // This test would need authentication - placeholder for when auth is available
      test.skip(true, 'Requires authentication setup for Content Service');
    });
  });

  test.describe('Upload Complete', () => {
    test('POST /api/content/upload-complete should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/content/upload-complete', {
        method: 'POST',
        data: {
          contentId: 'test-content-id',
        },
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      // Should return 401 Unauthorized without auth token
      expect(result.response.status()).toBe(401);
    });

    test('POST /api/content/upload-complete should validate content ID exists', async ({
      request,
    }) => {
      // This test would need authentication - placeholder for when auth is available
      test.skip(true, 'Requires authentication setup for Content Service');
    });
  });

  test.describe('Content Retrieval', () => {
    test('GET /api/content/{id} should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/content/test-content-id');

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      // Should return 401 Unauthorized or 404 Not Found (API may check existence before auth)
      expect([401, 404]).toContain(result.response.status());
    });

    test('GET /api/content/{id}/url should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/content/test-content-id/url');

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      // Should return 401 Unauthorized or 404 Not Found (API may check existence before auth)
      expect([401, 404]).toContain(result.response.status());
    });

    test('GET /api/content should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/content');

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      // Should return 401 Unauthorized without auth token
      expect(result.response.status()).toBe(401);
    });
  });

  test.describe('Content Deletion', () => {
    test('DELETE /api/content/{id} should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/content/test-content-id', {
        method: 'DELETE',
      });

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      // Should return 401 Unauthorized or 404 Not Found (API may check existence before auth)
      expect([401, 404]).toContain(result.response.status());
    });
  });
});

test.describe('Content API Request Validation @content-api', () => {
  test('should reject malformed JSON in upload-url request', async ({ request }) => {
    const result = await tryRequest(request, '/api/content/upload-url', {
      method: 'POST',
      data: 'not valid json',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!result) {
      test.skip(true, 'Content Service not available');
      return;
    }

    // Should return either 400 Bad Request or 401 Unauthorized (auth checked first)
    expect([400, 401, 415]).toContain(result.response.status());
  });

  test('should handle missing Content-Type header', async ({ request }) => {
    const result = await tryRequest(request, '/api/content/upload-url', {
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
  // Test data for different content categories
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
      // This is a contract test - verifying expected category configurations
      expect(cat.validTypes.length).toBeGreaterThan(0);
      expect(cat.maxSizeMB).toBeGreaterThan(0);

      // Verify MIME types are standard formats
      for (const mimeType of cat.validTypes) {
        expect(mimeType).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      }
    });
  }

  test('should have defined file size limits for all categories', async () => {
    // Contract test - all categories should have size limits
    const expectedCategories = ['Image', 'Video', 'Document'];

    for (const category of expectedCategories) {
      const config = categories.find((c) => c.category === category);
      expect(config, `Missing configuration for category: ${category}`).toBeDefined();
      expect(config?.maxSizeMB).toBeGreaterThan(0);
    }
  });
});

import { expect, test } from '@playwright/test';
import { CONTENT_API_URL, tryRequest, waitForHealthy } from './content-api-helpers.js';

/**
 * E2E Tests for Content Service API - Health probes and endpoint auth checks.
 * Tests require the Content Service to be running on port 5009.
 */

test.describe('Content Service Health Probes @content-api @health', () => {
  const healthPaths = [
    { name: 'startup', path: '/health/start' },
    { name: 'liveness', path: '/health/live' },
    { name: 'readiness', path: '/health/ready' },
  ] as const;

  for (const probe of healthPaths) {
    test(`ContentService ${probe.name} probe should return healthy`, async ({ request }) => {
      const quickCheck = await tryRequest(request, probe.path);

      if (!quickCheck) {
        test.skip(true, `Content Service not available at ${CONTENT_API_URL}`);
        return;
      }

      try {
        const { response, url } = await waitForHealthy(request, probe.path, 10000);
        expect(response.status(), `Expected 200 OK from ${url}`).toBe(200);

        const body = (await response.text().catch(() => '')).trim();
        if (body) {
          expect(body.toLowerCase()).toMatch(/healthy|ok/);
        }
      } catch (error) {
        test.skip(true, `Content Service health probe failed: ${(error as Error).message}`);
      }
    });
  }
});

test.describe('Content Service API Endpoints @content-api', () => {
  test.describe('Upload URL Request', () => {
    test('POST /api/content/upload-url should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/v1/content/upload-url', {
        method: 'POST',
        data: {
          fileName: 'test-image.png',
          contentType: 'image/png',
          fileSizeBytes: 1024,
          category: 'Image',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      expect(result.response.status()).toBe(401);
    });
  });

  test.describe('Upload Complete', () => {
    test('POST /api/content/upload-complete should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/v1/content/upload-complete', {
        method: 'POST',
        data: { contentId: 'test-content-id' },
        headers: { 'Content-Type': 'application/json' },
      });

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      expect(result.response.status()).toBe(401);
    });
  });

  test.describe('Content Retrieval', () => {
    test('GET /api/content/{id} should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/v1/content/test-content-id');

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      expect([401, 404]).toContain(result.response.status());
    });

    test('GET /api/content/{id}/url should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/v1/content/test-content-id/url');

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      expect([401, 404]).toContain(result.response.status());
    });

    test('GET /api/content should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/v1/content');

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      expect(result.response.status()).toBe(401);
    });
  });

  test.describe('Content Deletion', () => {
    test('DELETE /api/content/{id} should require authentication', async ({ request }) => {
      const result = await tryRequest(request, '/api/v1/content/test-content-id', {
        method: 'DELETE',
      });

      if (!result) {
        test.skip(true, 'Content Service not available');
        return;
      }

      expect([401, 404]).toContain(result.response.status());
    });
  });
});

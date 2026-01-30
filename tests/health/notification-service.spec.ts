import { test, expect } from '@playwright/test';

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5015';

test.describe('NotificationService Health Checks', () => {
  test('startup probe should return healthy', async ({ request }) => {
    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/health/start`
    );
    expect(response.status()).toBe(200);
  });

  test('liveness probe should return healthy', async ({ request }) => {
    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/health/live`
    );
    expect(response.status()).toBe(200);
  });

  test('readiness probe should return healthy when dependencies are up', async ({
    request,
  }) => {
    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/health/ready`
    );
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('Healthy');
  });

  // NotificationService uses ServiceDefaults health endpoints, not /api/health
  // The health endpoints are: /health/start, /health/live, /health/ready
  test('health endpoints should be consistent with ServiceDefaults', async ({
    request,
  }) => {
    // Verify all three probes are available and consistent
    const endpoints = ['/health/start', '/health/live', '/health/ready'];
    for (const endpoint of endpoints) {
      const response = await request.get(`${NOTIFICATION_SERVICE_URL}${endpoint}`);
      expect(response.status()).toBe(200);
    }
  });
});

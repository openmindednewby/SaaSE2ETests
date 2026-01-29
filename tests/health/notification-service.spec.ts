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

  test('api health endpoint should return healthy', async ({ request }) => {
    const response = await request.get(`${NOTIFICATION_SERVICE_URL}/api/health`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('Healthy');
  });
});

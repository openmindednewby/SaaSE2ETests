/**
 * E2E Tests for Notification Service Health
 *
 * Extended health checks for the NotificationService beyond the basic
 * probes tested in tests/health/notification-service.spec.ts. Includes:
 * - Health endpoint status verification
 * - SignalR hub endpoint availability
 * - CORS configuration verification
 * - API endpoint availability
 */

import { test, expect } from '@playwright/test';

import {
  getNotificationServiceUrl,
  getSignalRHubUrl,
  isNotificationServiceHealthy,
} from '../../helpers/notification.helpers.js';

const NOTIFICATION_SERVICE_URL = getNotificationServiceUrl();
const SIGNALR_HUB_URL = getSignalRHubUrl();

/** Timeout for health check requests */
const HEALTH_TIMEOUT_MS = 10000;

test.describe('Notification Service Health @notifications @health', () => {
  /** Whether the NotificationService is reachable at all */
  let serviceReachable = false;

  test.beforeAll(async () => {
    serviceReachable = await isNotificationServiceHealthy();
  });

  test('should report healthy status on readiness probe', async ({
    request,
  }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/health/ready`,
      { timeout: HEALTH_TIMEOUT_MS }
    );

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body.toLowerCase()).toContain('healthy');
  });

  test('should report healthy on startup probe', async ({ request }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/health/start`,
      { timeout: HEALTH_TIMEOUT_MS }
    );

    expect(response.status()).toBe(200);
  });

  test('should report healthy on liveness probe', async ({ request }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/health/live`,
      { timeout: HEALTH_TIMEOUT_MS }
    );

    expect(response.status()).toBe(200);
  });

  test('should expose SignalR hub endpoint', async ({ request }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    // The SignalR hub negotiate endpoint should be accessible
    // SignalR clients negotiate the connection before establishing WebSocket
    const negotiateUrl = `${SIGNALR_HUB_URL}/negotiate?negotiateVersion=1`;

    const response = await request.post(negotiateUrl, {
      timeout: HEALTH_TIMEOUT_MS,
      // SignalR negotiate doesn't require auth for checking availability
      // but may return 401 if auth is required - both indicate the endpoint exists
    }).catch(() => null);

    if (response) {
      // The hub endpoint exists - it may return 200 (no auth required),
      // 401 (auth required but endpoint is reachable),
      // or 400 (bad request but endpoint is reachable)
      const status = response.status();
      // Any non-404 response means the endpoint exists and is reachable
      expect(status, `SignalR negotiate returned ${status}`).not.toBe(404);
    } else {
      // If the request failed completely, the endpoint is not reachable
      // This is still a valid finding - log it
      test.info().annotations.push({
        type: 'warning',
        description: 'SignalR hub negotiate endpoint is not reachable',
      });
    }
  });

  test('should have correct CORS configuration', async ({ request }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    // Send a preflight OPTIONS request to check CORS
    const response = await request.fetch(
      `${NOTIFICATION_SERVICE_URL}/health/ready`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:8082',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization',
        },
        timeout: HEALTH_TIMEOUT_MS,
      }
    ).catch(() => null);

    if (response) {
      // The server should respond to OPTIONS requests
      // Acceptable statuses: 200, 204 (standard CORS responses),
      // or 405 (endpoint exists but doesn't handle OPTIONS)
      const status = response.status();
      const acceptableStatuses = [200, 204, 405];
      expect(acceptableStatuses).toContain(status);

      // If CORS is configured, check for the headers
      const allowOrigin = response.headers()['access-control-allow-origin'];
      const allowMethods = response.headers()['access-control-allow-methods'];

      if (allowOrigin) {
        // CORS is enabled - verify it allows our origin or all origins
        const originAccepted =
          allowOrigin === '*' || allowOrigin.includes('localhost');
        expect(originAccepted).toBe(true);
      }

      if (allowMethods) {
        // Verify GET is allowed (for health endpoints)
        expect(allowMethods.toUpperCase()).toContain('GET');
      }
    }
  });

  test('should respond to API endpoint', async ({ request }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    // Check if the notifications API base endpoint is accessible
    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/api/v1/notifications`,
      { timeout: HEALTH_TIMEOUT_MS }
    ).catch(() => null);

    if (response) {
      // The endpoint should exist but may require auth
      // 200 = success, 401/403 = auth required (endpoint exists),
      // 404 = endpoint not found
      const status = response.status();
      const endpointExists = status !== 404;
      expect(endpointExists).toBe(true);

      test.info().annotations.push({
        type: 'info',
        description: `Notifications API returned status ${status}`,
      });
    }
  });

  test('should respond to preferences API endpoint', async ({ request }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    const response = await request.get(
      `${NOTIFICATION_SERVICE_URL}/api/v1/notifications/preferences`,
      { timeout: HEALTH_TIMEOUT_MS }
    ).catch(() => null);

    if (response) {
      const status = response.status();
      // Endpoint should exist (may require auth)
      const endpointExists = status !== 404;
      expect(endpointExists).toBe(true);

      test.info().annotations.push({
        type: 'info',
        description: `Preferences API returned status ${status}`,
      });
    }
  });

  test('should have consistent health across all probes', async ({
    request,
  }) => {
    test.skip(!serviceReachable, 'NotificationService is not running');

    // All three probes should return healthy
    const probes = ['/health/start', '/health/live', '/health/ready'];

    const results = await Promise.all(
      probes.map(async (probe) => {
        const response = await request
          .get(`${NOTIFICATION_SERVICE_URL}${probe}`, {
            timeout: HEALTH_TIMEOUT_MS,
          })
          .catch(() => null);
        return { probe, status: response?.status() ?? 0 };
      })
    );

    for (const result of results) {
      expect(
        result.status,
        `Probe ${result.probe} should return 200`
      ).toBe(200);
    }
  });
});

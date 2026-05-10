import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getRealmToken } from '../../helpers/realm-token-helper.js';

/**
 * Cross-Realm Acceptance — multi-realm services must accept BOTH new realms.
 *
 * IdentityService, NotificationService, ContentService (Option-B partitioned),
 * and PaymentService all sit on BOTH sides of the product split. Their
 * AllowedRealms list contains both `questioner` and `onlinemenu`. They
 * MUST accept tokens from either realm.
 *
 * If any of these incorrectly walls off a realm, the wrong-realm rejection
 * surfaces as a 401 here — which would be a regression in the realm-validation
 * configuration of that service.
 *
 * Companion file to cross-realm-rejection.spec.ts (the actual wall).
 */

function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return (value && value.trim().length > 0) ? value.trim().replace(/\/+$/, '') : fallback;
}

const SERVICE_URLS = {
  identity: resolveBaseUrl('IDENTITY_API_URL', 'http://localhost:5002'),
  notification: resolveBaseUrl('NOTIFICATION_SERVICE_URL', 'http://localhost:5015'),
  content: resolveBaseUrl('CONTENT_API_URL', 'http://localhost:5009'),
  payment: resolveBaseUrl('PAYMENT_API_URL', 'http://localhost:5018'),
} as const;

const PROBE_PATHS = {
  identity: '/api/v1/tenants',
  notification: '/api/v1/notifications',
  content: '/api/v1/content',
  payment: '/api/v1/subscriptions/me',
} as const;

const HTTP_UNAUTHORIZED = 401;

async function probeStatus(
  apiContext: APIRequestContext,
  path: string,
  token: string,
): Promise<number> {
  const response = await apiContext.get(path, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  return response.status();
}

async function makeApiContext(baseUrl: string): Promise<APIRequestContext> {
  return await playwrightRequest.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    timeout: 30_000,
  });
}

test.describe('Multi-Realm Acceptance — both new realms accepted by shared services @cross-product-isolation', () => {
  test('questioner-realm token is ACCEPTED by IdentityService', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.identity);
    try {
      const status = await probeStatus(api, PROBE_PATHS.identity, token.accessToken);
      expect(
        status,
        `IdentityService should accept questioner-realm token (multi-realm service)`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by IdentityService', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.identity);
    try {
      const status = await probeStatus(api, PROBE_PATHS.identity, token.accessToken);
      expect(
        status,
        `IdentityService should accept onlinemenu-realm token (multi-realm service)`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is ACCEPTED by NotificationService', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.notification);
    try {
      const status = await probeStatus(api, PROBE_PATHS.notification, token.accessToken);
      expect(
        status,
        `NotificationService should accept questioner-realm token`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by NotificationService', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.notification);
    try {
      const status = await probeStatus(api, PROBE_PATHS.notification, token.accessToken);
      expect(
        status,
        `NotificationService should accept onlinemenu-realm token`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is ACCEPTED by ContentService (Option-B partitioned)', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.content);
    try {
      const status = await probeStatus(api, PROBE_PATHS.content, token.accessToken);
      expect(
        status,
        `ContentService should accept questioner-realm token (Option-B shared service)`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by ContentService (Option-B partitioned)', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.content);
    try {
      const status = await probeStatus(api, PROBE_PATHS.content, token.accessToken);
      expect(
        status,
        `ContentService should accept onlinemenu-realm token (Option-B shared service)`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('questioner-realm token is ACCEPTED by PaymentService', async () => {
    const token = await getRealmToken('questioner');
    if (!token.accessToken) {
      test.skip(true, `Questioner realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.payment);
    try {
      const status = await probeStatus(api, PROBE_PATHS.payment, token.accessToken);
      expect(
        status,
        `PaymentService should accept questioner-realm token`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });

  test('onlinemenu-realm token is ACCEPTED by PaymentService', async () => {
    const token = await getRealmToken('onlinemenu');
    if (!token.accessToken) {
      test.skip(true, `OnlineMenu realm token unavailable: ${token.unavailableReason}`);
      return;
    }
    const api = await makeApiContext(SERVICE_URLS.payment);
    try {
      const status = await probeStatus(api, PROBE_PATHS.payment, token.accessToken);
      expect(
        status,
        `PaymentService should accept onlinemenu-realm token`,
      ).not.toBe(HTTP_UNAUTHORIZED);
    } finally {
      await api.dispose();
    }
  });
});

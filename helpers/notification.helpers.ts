/**
 * Notification Service API Helpers
 *
 * Provides utility functions for interacting with the NotificationService
 * REST API during E2E tests. Used for:
 * - Triggering test notifications via the API
 * - Bulk notification injection for stress tests
 * - Fetching and clearing notification data
 * - Health check verification
 */

import axios, { type AxiosInstance } from 'axios';

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5015';

/** Timeout for individual API requests */
const API_TIMEOUT_MS = 10000;

/** Parameters for triggering a single test notification */
interface TriggerNotificationParams {
  userId: string;
  title: string;
  body?: string;
  type?: string;
  priority?: 'low' | 'normal' | 'high';
  actionUrl?: string;
}

/** Parameters for triggering bulk test notifications */
interface BulkNotificationParams {
  userId: string;
  titlePrefix?: string;
  body?: string;
  type?: string;
  priority?: 'low' | 'normal' | 'high';
}

/** Response shape from the notification API */
interface NotificationResponse {
  id: string;
  title: string;
  body?: string;
  type?: string;
  isRead: boolean;
  createdAt: string;
}

/** Health check response shape */
interface HealthResponse {
  status: string;
  entries?: Record<string, { status: string }>;
}

/**
 * Create an axios client for the NotificationService API
 */
function createNotificationClient(accessToken?: string): AxiosInstance {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  return axios.create({
    baseURL: NOTIFICATION_SERVICE_URL,
    timeout: API_TIMEOUT_MS,
    headers,
  });
}

/**
 * Trigger a single test notification via the NotificationService API.
 * Uses the test trigger endpoint which bypasses normal notification flow.
 *
 * @param params - Notification parameters
 * @param accessToken - Optional bearer token for authenticated requests
 * @returns The created notification ID, or null if the endpoint is not available
 */
export async function triggerNotification(
  params: TriggerNotificationParams,
  accessToken?: string
): Promise<string | null> {
  const client = createNotificationClient(accessToken);

  try {
    const response = await client.post('/api/notifications/test/trigger', {
      userId: params.userId,
      title: params.title,
      body: params.body ?? '',
      type: params.type ?? 'info',
      priority: params.priority ?? 'normal',
      actionUrl: params.actionUrl ?? '',
    });

    return response.data?.id ?? null;
  } catch {
    // Endpoint may not exist in all environments
    return null;
  }
}

/**
 * Trigger multiple test notifications in rapid succession.
 * Useful for stress testing notification delivery and UI rendering.
 *
 * @param params - Base notification parameters
 * @param count - Number of notifications to trigger
 * @param accessToken - Optional bearer token for authenticated requests
 * @returns Array of created notification IDs (nulls filtered out)
 */
export async function triggerBulkNotifications(
  params: BulkNotificationParams,
  count: number,
  accessToken?: string
): Promise<string[]> {
  const client = createNotificationClient(accessToken);
  const prefix = params.titlePrefix ?? 'Bulk Notification';

  try {
    // Try the bulk endpoint first
    const response = await client.post('/api/notifications/test/bulk', {
      userId: params.userId,
      titlePrefix: prefix,
      body: params.body ?? '',
      type: params.type ?? 'info',
      priority: params.priority ?? 'normal',
      count,
    });

    const ids = response.data?.ids;
    return Array.isArray(ids) ? ids : [];
  } catch {
    // Fallback: trigger notifications one at a time
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = await triggerNotification(
        {
          userId: params.userId,
          title: `${prefix} ${i + 1}`,
          body: params.body,
          type: params.type,
          priority: params.priority,
        },
        accessToken
      );
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  }
}

/**
 * Get notifications for a specific user via the API.
 *
 * @param userId - The user ID to fetch notifications for
 * @param accessToken - Optional bearer token for authenticated requests
 * @returns Array of notifications, or empty array if unavailable
 */
export async function getNotifications(
  userId: string,
  accessToken?: string
): Promise<NotificationResponse[]> {
  const client = createNotificationClient(accessToken);

  try {
    const response = await client.get(`/api/notifications`, {
      params: { userId },
    });

    return Array.isArray(response.data) ? response.data : [];
  } catch {
    return [];
  }
}

/**
 * Clear all test notifications for a specific user.
 * Uses the test cleanup endpoint.
 *
 * @param userId - The user ID whose notifications to clear
 * @param accessToken - Optional bearer token for authenticated requests
 * @returns true if cleanup succeeded, false otherwise
 */
export async function clearNotifications(
  userId: string,
  accessToken?: string
): Promise<boolean> {
  const client = createNotificationClient(accessToken);

  try {
    await client.delete(`/api/notifications/test/clear`, {
      params: { userId },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check the NotificationService health endpoint.
 *
 * @returns Health check response or null if unreachable
 */
export async function checkHealth(): Promise<HealthResponse | null> {
  const client = createNotificationClient();

  try {
    const response = await client.get('/health/ready');
    return response.data as HealthResponse;
  } catch {
    return null;
  }
}

/**
 * Check if the NotificationService is reachable and healthy.
 *
 * @returns true if the service responds with a healthy status
 */
export async function isNotificationServiceHealthy(): Promise<boolean> {
  const health = await checkHealth();
  return health?.status === 'Healthy';
}

/**
 * Get the SignalR hub URL for the notification service.
 */
export function getSignalRHubUrl(): string {
  return `${NOTIFICATION_SERVICE_URL}/notificationhub`;
}

/**
 * Get the notification service base URL.
 */
export function getNotificationServiceUrl(): string {
  return NOTIFICATION_SERVICE_URL;
}

import type { APIRequestContext, APIResponse } from '@playwright/test';

// Content API base URL - configurable via environment variable
function resolveContentApiUrl(): string {
  const envUrl = process.env.CONTENT_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'https://localhost:5009';
}

export const CONTENT_API_URL = resolveContentApiUrl();

/**
 * Attempts to reach the API with protocol fallback (https -> http).
 * Returns the first successful response.
 */
export async function tryRequest(
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
export async function waitForHealthy(
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

    // Wait before retry -- API-only polling, no Page object available
    // eslint-disable-next-line no-set-timeout-in-promise/no-set-timeout-in-promise
    await new Promise((r) => setTimeout(r, 750));
  }

  throw new Error(
    `Health probe did not become healthy within ${timeoutMs}ms. Last error: ${lastError}`,
  );
}

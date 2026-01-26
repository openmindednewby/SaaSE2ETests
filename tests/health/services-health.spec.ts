import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

type Service = {
  name: string;
  baseUrl: string;
};

function resolveBaseUrl(envVar: string, fallback: string) {
  const value = process.env[envVar];
  return (value && value.trim()) ? value.trim().replace(/\/+$/, '') : fallback;
}

function candidateBaseUrls(baseUrl: string) {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  const candidates = [clean];
  if (clean.startsWith('http://')) candidates.push(`https://${clean.slice('http://'.length)}`);
  if (clean.startsWith('https://')) candidates.push(`http://${clean.slice('https://'.length)}`);
  return [...new Set(candidates)];
}

async function tryGet(
  request: APIRequestContext,
  url: string,
): Promise<{ response: APIResponse; url: string } | null> {
  try {
    const response = await request.get(url);
    return { response, url };
  } catch {
    return null;
  }
}

async function waitForHealthy(
  request: APIRequestContext,
  urls: string[],
  timeoutMs: number,
): Promise<{ response: APIResponse; url: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | undefined;
  let lastUrl: string | undefined;

  while (Date.now() < deadline) {
    for (const url of urls) {
      const attempt = await tryGet(request, url);
      if (!attempt) continue;

      lastUrl = attempt.url;
      lastStatus = attempt.response.status();
      if (attempt.response.ok()) return attempt;
    }

    await new Promise(r => setTimeout(r, 750));
  }

  const details = lastUrl
    ? `Last response: ${lastStatus} from ${lastUrl}`
    : `No response (connection error) for any of: ${urls.join(', ')}`;
  throw new Error(`Health probe did not become healthy within ${timeoutMs}ms. ${details}`);
}

const services: Service[] = [
  { name: 'IdentityService', baseUrl: resolveBaseUrl('IDENTITY_API_URL', 'http://localhost:5002') },
  { name: 'QuestionerService', baseUrl: resolveBaseUrl('QUESTIONER_API_URL', 'https://localhost:5004') },
  { name: 'OnlineMenuService', baseUrl: resolveBaseUrl('ONLINEMENU_API_URL', 'https://localhost:5006') },
  { name: 'ContentService', baseUrl: resolveBaseUrl('CONTENT_API_URL', 'http://localhost:5009') },
];

const probes = [
  { name: 'startup', path: '/health/start' },
  { name: 'liveness', path: '/health/live' },
  { name: 'readiness', path: '/health/ready' },
] as const;

test.describe('Service Probes @health', () => {
  for (const service of services) {
    for (const probe of probes) {
      test(`${service.name} ${probe.name}`, async ({ request }) => {
        const baseUrls = candidateBaseUrls(service.baseUrl);
        const urls = baseUrls.map(b => `${b}${probe.path}`);
        const { response: res, url } = await waitForHealthy(request, urls, 30_000);

        expect(res.status(), `Expected 200 from ${url}`).toBe(200);

        // Be permissive: HealthCheckResponse can vary by host/format.
        const body = (await res.text().catch(() => '')).trim();
        if (body) {
          expect(body.toLowerCase()).toMatch(/healthy|ok/);
        }
      });
    }
  }
});

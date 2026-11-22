import http from 'node:http';
import https from 'node:https';

const WARMUP_TIMEOUT_MS = 10000;
const WARMUP_PATHS = ['/', '/bff/config'];

function getStatus(url: string): Promise<number> {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { rejectUnauthorized: false, timeout: WARMUP_TIMEOUT_MS }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('timeout', () => req.destroy(new Error(`no response within ${WARMUP_TIMEOUT_MS} ms`)));
    req.on('error', reject);
  });
}

export async function warmUpCanaryTarget(baseURL: string): Promise<void> {
  for (const path of WARMUP_PATHS) {
    const url = new URL(path, baseURL).toString();
    const started = Date.now();
    const status = await getStatus(url).catch((e: unknown) => {
      throw new Error(`[canary-warmup] GET ${url} failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    if (status < 200 || status >= 300) {
      throw new Error(`[canary-warmup] GET ${url} returned ${status}, expected 2xx`);
    }
    process.stdout.write(`[canary-warmup] GET ${url} -> ${status} in ${Date.now() - started} ms\n`);
  }
}

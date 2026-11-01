const CANARY_SLUG = /^e2c-([0-9a-f]{8})-.+$/;
const REQUIRED_ENV = [
  'KEFI_API_URL',
  'KEFI_KC_URL',
  'KEFI_KC_REALM',
  'KEFI_BFF_CLIENT_ID',
  'KEFI_BFF_CLIENT_SECRET',
  'KEFI_PLATFORM_ADMIN_USERNAME',
  'KEFI_PLATFORM_ADMIN_PASSWORD',
];
const HTTP_OK = 200;

export function canaryIdFromSlug(slug) {
  return CANARY_SLUG.exec(slug)?.[1] ?? null;
}

export function kefiSweepEnvGaps(env) {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

export async function mintKefiPlatformBearer(env, fetchImpl = fetch) {
  const resp = await fetchImpl(`${env.KEFI_KC_URL}/realms/${env.KEFI_KC_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: env.KEFI_BFF_CLIENT_ID,
      client_secret: env.KEFI_BFF_CLIENT_SECRET,
      username: env.KEFI_PLATFORM_ADMIN_USERNAME,
      password: env.KEFI_PLATFORM_ADMIN_PASSWORD,
      scope: 'openid',
    }),
  });
  if (resp.status !== HTTP_OK) throw new Error(`Kefi platform-admin token mint answered ${resp.status}`);
  return (await resp.json()).access_token;
}

async function listPublishedSlugs(apiUrl, fetchImpl) {
  const resp = await fetchImpl(`${apiUrl}/api/v1/t`);
  if (resp.status !== HTTP_OK) throw new Error(`GET /api/v1/t answered ${resp.status}`);
  return (await resp.json()).map((tenant) => tenant.slug);
}

async function cleanupRemovedTenant(apiUrl, canaryId, bearer, fetchImpl) {
  const resp = await fetchImpl(`${apiUrl}/api/v1/internal/canary-cleanup?canaryId=${canaryId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (resp.status !== HTTP_OK) return false;
  return (await resp.json()).tenantsDeleted > 0;
}

export async function sweepPublishedKefiCanaries({ apiUrl, getBearer, fetchImpl = fetch, dryRun, log }) {
  const slugs = await listPublishedSlugs(apiUrl, fetchImpl);
  const canaries = [...new Set(slugs.map(canaryIdFromSlug).filter(Boolean))];
  const result = { published: slugs.length, canaries, swept: [], failed: [] };
  log(`Kefi sweep: ${canaries.length} canary tenant(s) among ${slugs.length} published.`);
  if (dryRun || canaries.length === 0) return result;

  const bearer = await getBearer();
  for (const canaryId of canaries) {
    const removed = await cleanupRemovedTenant(apiUrl, canaryId, bearer, fetchImpl);
    (removed ? result.swept : result.failed).push(canaryId);
  }
  return result;
}

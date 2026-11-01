import type { Page } from '@playwright/test';

const CANARY_TENANT_NAME = /^e2c-[0-9a-f]{8}-/;
const SIGNUP_URL_GLOB = '**/api/v1/public/signup';

export async function authorizeCanarySignup(
  page: Page,
  tenantName: string,
  getBearer: () => Promise<string>,
): Promise<void> {
  if (!CANARY_TENANT_NAME.test(tenantName)) return;
  const bearer = await getBearer();
  await page.route(SIGNUP_URL_GLOB, (route) =>
    route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${bearer}` } }),
  );
}

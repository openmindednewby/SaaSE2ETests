import axios from 'axios';

import { sharedHttpsAgent } from '../http-agent.js';
import type { KefiAdminClient } from './kefiAdminClient.js';
import { newCanaryContext, type KefiCanaryContext } from './kefiCanaryIds.js';
import { KefiEventClient } from './kefiEventClient.js';
import { KefiMailbox, extractVerifyUrl, loadKefiMailboxConfig } from './kefiMailboxClient.js';
import { completeOnboarding } from './kefiOnboardingApi.js';
import type { OwnerCreds } from './kefiProGatesClient.js';
import { cleanupKefiCanary } from './kefiTeardown.js';
import { getKefiUrls } from './kefiUrls.js';

const HTTP_TIMEOUT_MS = 30_000;
const MAILBOX_TIMEOUT_MS = 90_000;
const MAILBOX_POLL_MS = 2_000;
const CREATED = 201;
const FIRST_ERROR_STATUS = 400;
const EVENT_DAYS_AHEAD = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SignupApiTenant {
  ctx: KefiCanaryContext;
  ownerCreds: OwnerCreds;
}

export async function provisionSignupApiTenant(admin: KefiAdminClient): Promise<SignupApiTenant> {
  const ctx = newCanaryContext();
  const { apiUrl } = getKefiUrls();
  const http = axios.create({ timeout: HTTP_TIMEOUT_MS, httpsAgent: sharedHttpsAgent, validateStatus: () => true });

  const signup = await http.post(`${apiUrl}/api/v1/public/signup`,
    { email: ctx.email, password: ctx.password, tenantName: ctx.tenantName },
    { headers: { Authorization: `Bearer ${await admin.getBearer()}` } });
  if (signup.status !== CREATED) {
    throw new Error(`[kefiSignupApiTenant] signup ${ctx.tenantName} expected 201, got ${signup.status}: ${JSON.stringify(signup.data)}`);
  }

  const mailbox = new KefiMailbox(loadKefiMailboxConfig(), { timeoutMs: MAILBOX_TIMEOUT_MS, pollIntervalMs: MAILBOX_POLL_MS });
  const verifyUrl = extractVerifyUrl(await mailbox.waitForMessageTo(ctx.email));
  if (!verifyUrl) throw new Error(`[kefiSignupApiTenant] no verify URL in the mail to ${ctx.email}`);
  const verified = await http.get(verifyUrl, { maxRedirects: 0 });
  if (verified.status >= FIRST_ERROR_STATUS) {
    throw new Error(`[kefiSignupApiTenant] verify ${verifyUrl} answered ${verified.status}`);
  }

  const bearer = await admin.getTenantOwnerBearer({ email: ctx.email, password: ctx.password });
  await completeOnboarding({ apiUrl, bearer });
  const ownerCreds: OwnerCreds = { ownerEmail: ctx.email, ownerPassword: ctx.password };
  await new KefiEventClient(admin).createMyEvent({
    ...ownerCreds,
    name: `${ctx.slugPrefix}Event`,
    dateIso: new Date(Date.now() + EVENT_DAYS_AHEAD * MS_PER_DAY).toISOString().slice(0, 10),
    venue: `${ctx.slugPrefix}Venue`,
  });
  return { ctx, ownerCreds };
}

export async function teardownSignupApiTenant(tenant: SignupApiTenant, admin: KefiAdminClient): Promise<void> {
  await cleanupKefiCanary(tenant.ctx.canaryId, { adminClient: admin });
}

import { RealTenantGuard, type BearerProbeClient } from '@dloizides/e2e-helpers';

export const PROTECTED_TENANT_SLUGS: readonly string[] = [
  'ubb',
  'csdf',
  'cdf',
  'ubs',
  'kucy',
  'kizomba-union-cy',
  'kizombaunioncy',
  'united-by-salsa',
  'unitedbybachata',
  'demo',
];

const guard = new RealTenantGuard({
  protectedSlugs: PROTECTED_TENANT_SLUGS,
  tenantHostPattern: /(^|\.)(kefi|kizombaunioncy)\.dloizides\.com$/,
  sharedHostPattern: /(^|\.)dloizides\.com$/,
  sharedHostExemptLabels: ['demo'],
  sessionProbe: {
    bffPath: '/bff/api/kefi/api/v1/admin/landing-config',
    apiPath: '/api/v1/admin/landing-config',
    pathSuffix: '/admin/landing-config',
  },
  writeAdvice: 'Point the spec at the e2e fixture tenant (KEFI_FIXTURE_TENANT_SLUG).',
  loginAdvice: 'Sign in as the e2e fixture organizer (KEFI_FIXTURE_ORGANIZER_USERNAME), reads included.',
});

export const loginRefusalSink = guard.loginRefusalSink;

export function realTenantOfSession(body: unknown): string | undefined {
  return guard.realTenantOfSession(body);
}

export function refuseRealTenantBearer(client: BearerProbeClient, bearer: string): Promise<string> {
  return guard.refuseRealTenantBearer(client, bearer);
}

export function installRealTenantWriteGuard(): void {
  guard.install();
}

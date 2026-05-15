/**
 * Shared https.Agent factory for axios callers in helpers/.
 *
 * Mirrors Playwright's `ignoreHTTPSErrors` config (set globally in
 * `playwright.config.ts`). Activates when:
 *   - `E2E_IGNORE_HTTPS_ERRORS=true`, OR
 *   - `E2E_HOST_OVERRIDE_IP` is set (the latter implies a non-public-DNS
 *     target like staging, which uses Traefik's self-signed default cert).
 *
 * Without this, axios calls from `helpers/*` throw `Error: self-signed
 * certificate` when targeting staging, while `APIRequestContext` calls succeed
 * because Playwright honors `ignoreHTTPSErrors`. Test results become
 * incoherent — some succeed, some fail with TLS errors on the same hostname.
 *
 * Helpers should import `sharedHttpsAgent` and pass it to `axios.create` as
 * the `httpsAgent` option.
 *
 * Side-effect on module load: ensures the Node-side DNS host-override is
 * installed. Playwright workers don't re-evaluate `playwright.config.ts`, so
 * the install call in the config module only fires in the main process. By
 * piggybacking on this module (which is imported by every axios-using helper)
 * we get the patch into every worker without an explicit per-test hook.
 */
import * as https from 'node:https';
import { installHostOverride } from '../fixtures/host-override.js';

installHostOverride();

export function isIgnoreHttpsErrors(): boolean {
  return (
    (process.env.E2E_IGNORE_HTTPS_ERRORS ?? '').toLowerCase() === 'true' ||
    Boolean(process.env.E2E_HOST_OVERRIDE_IP?.trim())
  );
}

export const sharedHttpsAgent: https.Agent | undefined = isIgnoreHttpsErrors()
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

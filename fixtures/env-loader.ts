import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const VALID_TARGETS = ['local', 'staging', 'prod'] as const;
type EnvTarget = (typeof VALID_TARGETS)[number];

function isValidTarget(value: string): value is EnvTarget {
  return (VALID_TARGETS as readonly string[]).includes(value);
}

/**
 * Loads E2E env files in a fixed order:
 *   1. `.env.<target>`         (URLs / non-secret config, committed)
 *   2. `.env.<target>.secrets` (passwords / tokens, gitignored, overrides)
 *
 * `target` is read from `process.env.E2E_TARGET` (default: 'local').
 *
 * Logs the loaded target + which files were found to stdout, so any
 * Playwright run banner reveals which environment was actually used.
 *
 * Idempotent: dotenv.config respects existing `process.env` keys by default,
 * so calling this from both playwright.config.ts AND globalSetup is safe.
 */
function loadE2EEnv(): EnvTarget {
  const raw = process.env.E2E_TARGET ?? 'local';
  if (!isValidTarget(raw)) {
    throw new Error(`Invalid E2E_TARGET="${raw}". Must be one of: ${VALID_TARGETS.join(', ')}`);
  }

  const target = raw;
  const e2eRoot = path.resolve(__dirname, '..');
  const urlsFile = path.join(e2eRoot, `.env.${target}`);
  const secretsFile = path.join(e2eRoot, `.env.${target}.secrets`);

  const urlsLoaded = fs.existsSync(urlsFile);
  const secretsLoaded = fs.existsSync(secretsFile);

  if (urlsLoaded) dotenv.config({ path: urlsFile });
  if (secretsLoaded) dotenv.config({ path: secretsFile });

  process.stdout.write(
    `[e2e-env] target=${target} urls=${urlsLoaded ? path.basename(urlsFile) : 'MISSING'} secrets=${secretsLoaded ? path.basename(secretsFile) : 'MISSING'}\n`,
  );

  if (!urlsLoaded) {
    process.stderr.write(
      `[e2e-env] WARNING: ${urlsFile} not found. Tests will use process.env defaults only.\n`,
    );
  }

  return target;
}

export { loadE2EEnv, VALID_TARGETS };
export type { EnvTarget };

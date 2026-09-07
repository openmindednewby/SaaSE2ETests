#!/usr/bin/env node
// Run the E2ETests `aml-api` Playwright project against a DEPLOYED AMLService.
//
// WHY THIS EXISTS: E2ETests/playwright.config.ts deliberately loads no .env, and the AML credentials
// (AML_API_KEY, AML_BASE_URL) live in PROOViD/AMLService/.env — which is where the AMLService waves
// read them from. Without this shim the E2ETests aml specs authenticate with nothing and every test
// SKIPS: a green run that observed literally nothing. Real env vars always win over the file.
//
// Usage:  node scripts/run-aml-e2e.mjs [extra playwright args...]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AML_ENV = resolve(HERE, '..', '..', 'PROOViD', 'AMLService', '.env');
const KV = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function loadEnvFile(path) {
  if (!existsSync(path)) {
    console.warn(`[run-aml-e2e] no ${path} — relying on the ambient environment.`);
    return;
  }
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const match = KV.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue; // a real env var wins
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

loadEnvFile(AML_ENV);
// The AMLService suite calls it AML_BASE_URL; the E2ETests helper calls it AML_API_URL.
if (!process.env.AML_API_URL && process.env.AML_BASE_URL)
  process.env.AML_API_URL = process.env.AML_BASE_URL;

if (!process.env.AML_API_KEY) {
  console.error(
    '[run-aml-e2e] AML_API_KEY is not set and was not found in PROOViD/AMLService/.env. Every AML spec ' +
      'would SKIP, which is a green that observes nothing. Refusing to run.',
  );
  process.exit(2);
}
console.log(`[run-aml-e2e] target ${process.env.AML_API_URL ?? '(helper default)'}`);

const args = ['playwright', 'test', '--project=aml-api', ...process.argv.slice(2)];
const result = spawnSync('npx', args, { cwd: resolve(HERE, '..'), stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);

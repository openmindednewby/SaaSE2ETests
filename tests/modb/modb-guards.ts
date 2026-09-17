// MODB-2 D-INT-14 review fixes: the pure guard logic of the MODB API suite. It imports nothing (no Playwright), so
// plain `node` can exercise it; the spec and helpers turn a thrown error or a returned message into a failure.

/** wl-api-gateway base URL. Committed in .env.local / .env.staging (the staging NodePort over WireGuard). */
export const GATEWAY_URL_ENV = 'MODB_GATEWAY_URL';
/** `<scenario id>`: enables exactly that ONE no_callback scenario. Each blocks a staging check worker for ~3 h. */
export const NO_CALLBACK_ENV = 'MODB_E2E_NO_CALLBACK';
/** `1`: a run that never observed adverse media `Ok` with score > 0 warns instead of failing. */
export const ALLOW_AM_UNAVAILABLE_ENV = 'MODB_E2E_ALLOW_AM_UNAVAILABLE';

type Env = Readonly<Record<string, string | undefined>>;

/** The gateway base URL without a trailing slash. Unset or blank throws, naming the variable and where it lives. */
export function resolveGatewayUrl(env: Env): string {
  const raw = env[GATEWAY_URL_ENV]?.trim();
  if (raw) return raw.replace(/\/+$/, '');
  const where = `E2E_TARGET=${env.E2E_TARGET ?? 'local'}${env.CI ? ', CI' : ''}`;
  throw new Error(
    `${GATEWAY_URL_ENV} is unset (${where}). Set it to the wl-api-gateway base URL; .env.local and .env.staging carry ` +
      'the staging NodePort. An in-cluster or CI runner must set it explicitly.',
  );
}

/**
 * The one no_callback scenario this run enables, or null when the variable is unset or blank. Any other value,
 * including the old all-or-nothing `1`, throws: a typo must fail the run, not skip silently.
 */
export function selectNoCallbackScenario(env: Env, knownIds: readonly string[]): string | null {
  const raw = env[NO_CALLBACK_ENV]?.trim();
  if (!raw) return null;
  if (knownIds.includes(raw)) return raw;
  throw new Error(`${NO_CALLBACK_ENV}=${raw} is not a no_callback scenario id. Use exactly one of: ${knownIds.join(', ')}`);
}

/** A scenario with no silent check always runs; a no_callback scenario runs only when it is THE selected one. */
export function scenarioEnabled(id: string, pendingCount: number, selected: string | null): boolean {
  return pendingCount === 0 || id === selected;
}

/** Per-worker record of screened AML results: how many, how many observed a positive screen, which did not. */
export interface ScreenLedger {
  screened: number;
  positive: number;
  notObserved: string[];
}

export function newScreenLedger(): ScreenLedger {
  return { screened: 0, positive: 0, notObserved: [] };
}

/** Records one screened result. Returns true only for adverse media `Ok` with a numeric score above zero. */
export function recordScreen(ledger: ScreenLedger, note: string, amStatus: unknown, score: unknown): boolean {
  ledger.screened += 1;
  const positive = amStatus === 'Ok' && typeof score === 'number' && score > 0;
  if (positive) ledger.positive += 1;
  else ledger.notObserved.push(note);
  return positive;
}

export interface ScreenVerdict {
  fail: string | null;
  warn: string | null;
}

/**
 * Suite-level verdict. No screening at all (a --grep over cancelled scenarios) claims nothing, so it passes. A
 * screening with no positive observation fails unless MODB_E2E_ALLOW_AM_UNAVAILABLE=1, which only downgrades it
 * to a warning. Any other non-empty value of that variable throws.
 */
export function positiveScreenVerdict(ledger: ScreenLedger, env: Env): ScreenVerdict {
  const allow = env[ALLOW_AM_UNAVAILABLE_ENV]?.trim();
  if (allow && allow !== '1') throw new Error(`${ALLOW_AM_UNAVAILABLE_ENV}=${allow}: only 1 is accepted`);
  if (ledger.screened === 0 || ledger.positive > 0) return { fail: null, warn: null };
  const summary =
    `${ledger.screened} screening(s), none observed adverse media Ok with score > 0, so the positive-screen ` +
    `contract was NOT checked: ${ledger.notObserved.join('; ')}`;
  if (allow === '1') return { fail: null, warn: `${summary} (allowed by ${ALLOW_AM_UNAVAILABLE_ENV}=1)` };
  return { fail: `${summary}. Set ${ALLOW_AM_UNAVAILABLE_ENV}=1 only when GDELT is known degraded.`, warn: null };
}

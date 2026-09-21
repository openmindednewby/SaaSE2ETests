// Shared building blocks for the switched-on adverse-media specs (@aml-api tier):
// aml-adverse-media-hit.spec.ts (AM-E2E-5, AM-E2E-7) and aml-adverse-media-surface.spec.ts (AM-E2E-6, 6B).
// Split out of aml-adverse-media-hit.spec.ts for the 300-line limit (MODB-BOARD-1 "Azure board items to
// Module B PR bundles"); behaviour is unchanged.
import { expect, test } from '@playwright/test';
import {
  ADVERSE_MEDIA_CATEGORY,
  AML_API_URL,
  adverseMediaCapability,
  screen,
  type AdverseMediaCapability,
} from './aml-helpers.js';

export const AUTH_REJECTED = [401, 403];
export const CREATED = 201;
export const OK = 200;

// AdverseMediaCategory (AMLService/Domain/Screening/AdverseMediaCategory.cs), serialized by NAME.
export const ADVERSE_MEDIA_CATEGORIES = new Set([
  'Unknown',
  'FinancialCrime',
  'Cybercrime',
  'Regulatory',
  'HighRisk',
  'GeneralCrime',
]);

// The subjects these controls screen. 🔴 CORRECTED 2026-09-08 from the original golden-corpus
// `positives` bucket (`Jho Low`, `Gulnara Karimova`, `Bashar al-Assad`) after the index carried real
// rows for the first time. MEASURED against the live API on that date: those three return ZERO
// adverse-media matches, because the slice-tailer only scans names in its watch book and none of the
// three is in it. Screening a name the tailer never watched can only ever produce a zero, so the old
// corpus made AM-E2E-5/6/7 structurally unable to observe a hit — three controls that had never run a
// single assertion between them.
//
// What IS in the book, and why each name is here:
//   Benjamin Netanyahu — a MonitoredSubject (tenant 7e57a001-…-0001, enrolled 2026-09-08). FIRST on
//     purpose: it is the only corpus name the tenant-scoped roster probe can SEE, so it is what turns
//     ruleOnAmCorpus into `mustAssert`, and AM-E2E-7 dispositions POSITIVE_CORPUS[0]. 5 bound articles.
//   Vladimir Putin — NOT a MonitoredSubject; he entered the book via the IncludeScreenedNames branch
//     off MediaLookups (AdverseMediaSliceTailService.cs:721-728). 137 bound articles, the densest
//     input available, so AM-E2E-6 has evidence to assert on even if the enrolled subject is unbound.
//   Jho Low — kept as the original-corpus canary. It is expected to contribute zero today; if it ever
//     starts contributing, the book widened and that is worth noticing.
// When the stage is AVAILABLE, a corpus subject is provably in the book, and this whole list still
// returns nothing, the collection leg is broken — that is what AM-E2E-5 turns red on.
export const POSITIVE_CORPUS = ['Benjamin Netanyahu', 'Vladimir Putin', 'Jho Low'];

export interface AmMatch {
  externalId?: string | null;
  matchKey?: string | null;
  rejectionTag?: string | null;
  adverseMediaCategory?: string | null;
  headline?: string | null;
  publisher?: string | null;
}
export interface AmScreen {
  id: string;
  decision?: string | null;
  matchedEntities: AmMatch[];
  adverseMediaStatus?: string | null;
  reason?: { code: string; category?: string | null } | null;
  reasonCodes?: string[] | null;
}
export interface CaseMatch {
  matchKey: string;
  rejectionTag?: string | null;
  reviewStatus?: string | null;
  reviewReason?: string | null;
  reviewedAt?: string | null;
}
export interface CaseDetail {
  id: string;
  reviewStatus: string;
  matches: CaseMatch[];
}

export const isAm = (m: AmMatch | CaseMatch): boolean =>
  m.rejectionTag === ADVERSE_MEDIA_CATEGORY || !!(m as AmMatch).adverseMediaCategory;

export const amOf = (body: AmScreen): AmMatch[] => body.matchedEntities.filter(isAm);

// D-MODB-AM-13: the tenant whose adverse-media surface override is ON (created for D-MODB-AM-9).
export const SURFACE_ON_TENANT_ID = process.env.MODB_SURFACE_ON_TENANT_ID?.trim() || null;
export const SURFACE_ON_API_KEY = process.env.MODB_SURFACE_ON_AML_API_KEY?.trim() || null;
/**
 * `adverseMediaStatus=Unavailable` means the GDELT stage missed its latency budget, i.e. "not yet", not
 * "broken". Re-screen with backoff, the same way AC-MOCK-6 does (modb-mock-source-links.spec.ts).
 */
export const AM_RETRY_INTERVALS_MS = [5_000, 10_000, 20_000, 30_000];
export const AM_RETRY_TIMEOUT_MS = 120_000;
/** Up to three corpus subjects, each allowed one full retry budget. */
export const AM_E2E_6_TIMEOUT_MS = 420_000;
export const HTTP_URL = /^https?:\/\/\S+$/;

/** Screen `fullName` with `apiKey` until adverse media leaves Unavailable, or fail with the last status seen. */
export async function screenUntilAmSettles(
  request: Parameters<typeof screen>[0],
  fullName: string,
  apiKey: string,
  who: string,
): Promise<AmScreen> {
  let last: AmScreen | null = null;
  await expect
    .poll(
      async () => {
        const res = await screen(request, { fullName, adverseMedia: true, includeReasoning: true }, apiKey);
        const http = res?.status() ?? 0;
        if (!res || http !== CREATED) return `http ${http}`;
        last = (await res.json()) as AmScreen;
        return last.adverseMediaStatus ?? 'missing';
      },
      {
        message:
          `screening '${fullName}' as ${who} at ${AML_API_URL} never reached adverseMediaStatus=Ok within the ` +
          'retry budget (Unavailable = the GDELT stage kept missing its latency budget; http 401/403 = key rejected)',
        intervals: AM_RETRY_INTERVALS_MS,
        timeout: AM_RETRY_TIMEOUT_MS,
      },
    )
    .toBe('Ok');
  return last as unknown as AmScreen;
}

/** The first corpus subject whose settled screen carries an adverse-media match, or null if none does. */
export async function firstCorpusHit(
  request: Parameters<typeof screen>[0],
  apiKey: string,
  who: string,
): Promise<{ fullName: string; body: AmScreen; hits: AmMatch[] } | null> {
  for (const fullName of POSITIVE_CORPUS) {
    const body = await screenUntilAmSettles(request, fullName, apiKey, who);
    const hits = amOf(body);
    if (hits.length > 0) return { fullName, body, hits };
  }
  return null;
}

export function skipNoCorpusHit(testId: string): void {
  test.info().annotations.push({
    type: `${testId}-never-executed`,
    description: `no corpus subject carried an adverse-media match, so ${testId} asserted nothing on this run.`,
  });
  test.skip(
    true,
    'the stage is available but no corpus subject carried an adverse-media match. AM-E2E-5 is the ' +
      'control for this: it FAILS when a corpus subject is provably in the indexed name book and ' +
      'slices were scanned against it, and reports its own no-input outcome otherwise.',
  );
}

/**
 * Skip ONLY when the stage says it is unavailable. This is the discriminator AM-E2E-3 lacks: an empty
 * result set is not evidence that collection is off.
 */
export async function requireAvailableStage(
  request: Parameters<typeof screen>[0],
): Promise<AdverseMediaCapability | null> {
  const cap = await adverseMediaCapability(request);
  if (!cap) {
    test.skip(true, `screening-capabilities unreadable at ${AML_API_URL} — cannot tell on from off.`);
    return null;
  }
  if (!cap.available) {
    test.skip(
      true,
      `adverse-media collection is OFF (source=${cap.source}, reason=${cap.unavailableReason ?? 'none'}) ` +
        '— the switched-on assertions have nothing to observe. This skip is keyed to the CAPABILITY, so ' +
        'it disappears on its own the moment the stage reports itself available.',
    );
    return null;
  }
  return cap;
}

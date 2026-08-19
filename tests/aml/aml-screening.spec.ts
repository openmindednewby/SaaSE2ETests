// @aml-api tier — the AML screening decision engine over HTTP (no browser). Locks the two testable
// review findings (Eric, 2026-08-19) against any deployed AMLService, pointed at staging by default:
//   #368 — a wrong date of birth must never silently clear a sanctioned person.
//   #364 — the PEP taxonomy is the §5.5 FOUR classes, and an IGO senior is Regional, not National.
// Every test skips (not fails) when the service is unreachable or AML_API_KEY isn't accepted, so it is
// safe on the dev PC and meaningful on the nightly in-cluster runner.
import { expect, test } from '@playwright/test';
import {
  AML_API_KEY,
  AML_API_URL,
  FOUR_CLASS_TAXONOMY,
  amlReachable,
  screen,
  type ScreeningResult,
} from './aml-helpers.js';

const AUTH_REJECTED = [401, 403];

test.describe('AML screening decision engine @aml-api', () => {
  test.beforeEach(async ({ request }) => {
    if (!AML_API_KEY) test.skip(true, 'AML_API_KEY is not set — cannot authenticate screenings.');
    if (!(await amlReachable(request))) test.skip(true, `AML API not reachable at ${AML_API_URL}.`);
  });

  test('#368 a wrong DoB does not silently clear a sanctioned person', async ({ request }) => {
    // Baseline: the correct DoB is unambiguously a sanctions hit.
    const correct = await screen(request, { fullName: 'Bashar al-Assad', dateOfBirth: '1965-09-11' });
    if (!correct || AUTH_REJECTED.includes(correct.status())) {
      test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
      return;
    }
    expect(correct.status()).toBe(201);
    const baseline = (await correct.json()) as ScreeningResult;
    expect(baseline.isMatch).toBeTruthy();
    expect(baseline.decision).not.toBe('Pass');

    // The finding: a WRONG DoB must not turn that into a clean Pass. Forced to the intended HighScore
    // surfacing (the #368 fix) so the assertion is deterministic regardless of the tenant's effective
    // default — a near-exact name + mismatched DoB has to surface for Review, never clear silently.
    const wrong = await screen(request, {
      fullName: 'Bashar al-Assad',
      dateOfBirth: '1970-01-01',
      dobMismatchSurfacing: 'HighScore',
    });
    expect(wrong).not.toBeNull();
    expect(wrong!.status()).toBe(201);
    const result = (await wrong!.json()) as ScreeningResult;
    expect(result.isMatch, 'a wrong DoB must not drop a sanctioned hit to zero matches (#368)').toBeTruthy();
    expect(result.decision).not.toBe('Pass');
  });

  test('#364 an IGO senior tiers Regional (class 2), not National', async ({ request }) => {
    const res = await screen(request, { fullName: 'Antonio Guterres' });
    if (!res || AUTH_REJECTED.includes(res.status())) {
      test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
      return;
    }
    expect(res.status()).toBe(201);
    const body = (await res.json()) as ScreeningResult;

    // António Guterres (Q57757) — UN Secretary-General, the canonical senior IGO official.
    const guterres = body.matchedEntities.find(m => m.externalId === 'Q57757');
    expect(guterres, 'Guterres (Q57757) should be a match').toBeTruthy();
    // §5.5 class 2 (Regional) covers senior international-organisation officials; "National" is the #364 mis-tier.
    expect(guterres!.pepTier).toBe('Regional');
  });

  for (const fullName of ['Donald Trump', 'Antonio Guterres', 'Xi Jinping']) {
    test(`#364 pepTier stays within the four §5.5 classes — ${fullName}`, async ({ request }) => {
      const res = await screen(request, { fullName });
      if (!res || AUTH_REJECTED.includes(res.status())) {
        test.skip(true, `AML_API_KEY not accepted at ${AML_API_URL}.`);
        return;
      }
      expect(res.status()).toBe(201);
      const body = (await res.json()) as ScreeningResult;

      for (const entity of body.matchedEntities) {
        const tier = entity.pepTier;
        if (!tier || tier === 'Unknown' || tier === 'None') continue;
        expect(
          FOUR_CLASS_TAXONOMY.has(tier),
          `'${fullName}' returned pepTier '${tier}', outside the four §5.5 classes ` +
            `(${[...FOUR_CLASS_TAXONOMY].join(' / ')}) — the #364 taxonomy defect.`,
        ).toBeTruthy();
      }
    });
  }
});

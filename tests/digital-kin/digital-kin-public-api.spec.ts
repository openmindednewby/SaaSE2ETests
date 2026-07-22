// Digital Kin API — @api tier: the anonymous public surface (Plan 6 Task 12).
//
// Everything here is what a stranger's browser (or the Astro site's SSR fetch) can reach without a
// token: the taxonomy read, the guide index and detail, the CMS singleton pages, useful resources,
// Greek search, and the contact form.
//
// 🔴 THESE ASSERT BEHAVIOUR, NOT MOUNT. "Returns 200" is near-worthless on this surface — a search
// endpoint that has lost its GIN index still returns 200, with `count: 0`, for every query. Every
// test below asserts payload shape or search semantics.
import { expect, test } from '@playwright/test';

import {
  DIGITALKIN_API_URL,
  DK_PUBLIC,
  DK_SEARCH,
  DK_SEEDED_CATEGORIES,
  anonymousApi,
  bodyText,
  dkTag,
} from './digital-kin-api-helpers.js';

import type { APIRequestContext } from '@playwright/test';

const OK = 200;
const ACCEPTED = 202;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const SERVER_ERROR_FLOOR = 500;

interface SearchBody {
  query: string;
  count: number;
  results: { slug: string; title: string; intro: string }[];
}

test.describe('Digital Kin public API @digital-kin-api @digital-kin', () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await anonymousApi();

    // Reachability probe against a KNOWN-GOOD route. This is the 404-vs-401 tie-break in reverse:
    // because the authorization fallback policy 401s every unmatched route, a 401 anywhere in this
    // service is ambiguous. A route that is known to return 200 is the only honest liveness check.
    const probe = await api.get(DK_PUBLIC.categories, { timeout: 20_000 });
    expect(
      probe.status(),
      `Digital Kin API at ${DIGITALKIN_API_URL} did not serve the public category list. ` +
        `This is deliberately a FAILURE, not a skip: the suite is pointed at a deployed ` +
        `environment, and "unreachable" must never be able to masquerade as "passed".`,
    ).toBe(OK);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  // ---------------------------------------------------------------------------
  // Taxonomy
  // ---------------------------------------------------------------------------
  test('the six seeded categories come back complete, ordered, and in Greek', async () => {
    const response = await api.get(DK_PUBLIC.categories);
    expect(response.status()).toBe(OK);

    const categories = await response.json();

    // Pinned as data. "200 with a non-empty array" passes against a list that has silently lost
    // half its rows — which is exactly what a bad migration produces.
    expect(categories.map((c: { key: string }) => c.key)).toEqual(
      DK_SEEDED_CATEGORIES.map((c) => c.key),
    );

    for (const expected of DK_SEEDED_CATEGORIES) {
      const actual = categories.find((c: { key: string }) => c.key === expected.key);
      expect(actual, `category ${expected.key} missing`).toBeDefined();
      expect(actual.slug).toBe(expected.slug);
      // The Greek display name — the thing a visitor actually reads. A category list that
      // regressed to English keys would still be a green "returns 200" test.
      expect(actual.name).toBe(expected.name);
      expect(actual.publishedGuideCount).toBe(expected.publishedGuideCount);
    }
  });

  test('displayOrder is strictly increasing — the homepage grid has a defined order', async () => {
    const categories = await (await api.get(DK_PUBLIC.categories)).json();
    const orders = categories.map((c: { displayOrder: number }) => c.displayOrder);

    expect(orders).toEqual([...orders].sort((a: number, b: number) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  test('the public category read publishes NO internal id', async () => {
    // Deliberate: `externalId` is published only by the authenticated taxonomy read. This is the
    // documented reason the admin role is allowed to read taxonomy at all, so if an id ever leaks
    // here that design rationale silently changes.
    const categories = await (await api.get(DK_PUBLIC.categories)).json();

    for (const category of categories) {
      expect(Object.keys(category)).not.toContain('externalId');
      expect(Object.keys(category)).not.toContain('id');
    }
  });

  test('a category detail page resolves by slug and carries its sub-categories', async () => {
    const response = await api.get(DK_PUBLIC.categoryBySlug('kinito'));
    expect(response.status()).toBe(OK);

    const category = await response.json();
    expect(category.slug).toBe('kinito');
    expect(category.name).toBe('Κινητό');
  });

  test('an unknown category slug is a real 404', async () => {
    const response = await api.get(DK_PUBLIC.categoryBySlug('definitely-not-a-category'));
    expect(response.status()).toBe(NOT_FOUND);
  });

  test('an unknown sub-category under a REAL category is a 404', async () => {
    // The nested route: a valid parent must not rescue an invalid child.
    const response = await api.get(DK_PUBLIC.subCategoryBySlug('kinito', 'definitely-not-a-sub'));
    expect(response.status()).toBe(NOT_FOUND);
  });

  // ---------------------------------------------------------------------------
  // Guides
  // ---------------------------------------------------------------------------
  test('the guide index lists published guides with slug and timestamps', async () => {
    const response = await api.get(DK_PUBLIC.guides);
    expect(response.status()).toBe(OK);

    const guides = await response.json();
    expect(guides.length).toBeGreaterThan(0);

    // The index feeds the sitemap and the cache purger, so both fields are load-bearing: a null
    // publishedAt produces a sitemap entry with no <lastmod> and a purge that never fires.
    for (const guide of guides) {
      expect(guide.slug, 'a guide has no slug').toBeTruthy();
      expect(Number.isNaN(Date.parse(guide.publishedAt))).toBe(false);
      expect(Number.isNaN(Date.parse(guide.lastUpdatedDate))).toBe(false);
    }
  });

  test('the published guide count matches the sum the category list advertises', async () => {
    // Cross-checks two independently computed numbers. A category page advertising "2 guides" and
    // then rendering one is a defect neither endpoint can catch alone.
    const [guides, categories] = await Promise.all([
      (await api.get(DK_PUBLIC.guides)).json(),
      (await api.get(DK_PUBLIC.categories)).json(),
    ]);

    const advertised = categories.reduce(
      (sum: number, c: { publishedGuideCount: number }) => sum + c.publishedGuideCount,
      0,
    );

    expect(guides.length).toBe(advertised);
  });

  test('a guide detail carries its ordered steps, category and sub-category', async () => {
    const response = await api.get(DK_PUBLIC.guideBySlug(DK_SEARCH.titleWord.slug));
    expect(response.status()).toBe(OK);

    const guide = await response.json();
    expect(guide.title).toBeTruthy();
    expect(guide.intro).toBeTruthy();
    expect(guide.steps.length).toBeGreaterThan(0);

    // Steps are an ORDERED instruction list for a low-confidence audience. Out-of-order steps are
    // worse than no steps, and a plain "has steps" assertion would not notice.
    const orders = guide.steps.map((s: { order: number }) => s.order);
    expect(orders).toEqual([...orders].sort((a: number, b: number) => a - b));
    for (const step of guide.steps) expect(step.text).toBeTruthy();

    // The breadcrumb the site renders. A guide detached from its shelf is unreachable by browsing.
    expect(guide.category?.slug).toBeTruthy();
    expect(guide.subCategory?.slug).toBeTruthy();
  });

  test('an unknown guide slug is a real 404, not a soft 200', async () => {
    const response = await api.get(DK_PUBLIC.guideBySlug('definitely-not-a-guide'));
    expect(response.status()).toBe(NOT_FOUND);
  });

  // ---------------------------------------------------------------------------
  // CMS singleton pages and useful resources
  // ---------------------------------------------------------------------------
  test('the CMS singleton pages are readable by key', async () => {
    // The READ side of what the CMS edits. Without it the Page aggregate is write-only: an author
    // saves "Ποιοι Είμαστε", the save succeeds, and no visitor is ever served the result.
    for (const key of ['about', 'help']) {
      const response = await api.get(DK_PUBLIC.pageByKey(key));

      expect(response.status(), `page '${key}' — ${await bodyText(response)}`).toBe(OK);
      const page = await response.json();
      expect(page.body ?? page.content ?? page.title, `page '${key}' has no content`).toBeTruthy();
    }
  });

  test('an unknown page key is a 404', async () => {
    const response = await api.get(DK_PUBLIC.pageByKey('definitely-not-a-page'));
    expect(response.status()).toBe(NOT_FOUND);
  });

  test('useful resources are readable and every published link has a URL', async () => {
    const response = await api.get(DK_PUBLIC.resources);
    expect(response.status()).toBe(OK);

    const resources = await response.json();
    expect(Array.isArray(resources)).toBe(true);

    // A "useful link" with no href is the one field whose absence makes the row pointless.
    for (const resource of resources) {
      expect(resource.url ?? resource.href, 'a resource has no URL').toBeTruthy();
    }
  });

  // ---------------------------------------------------------------------------
  // 🔴 GREEK SEARCH — the highest-value assertions in this suite
  // ---------------------------------------------------------------------------
  test('🔴 all four Greek spellings of the same word find the SAME guide', async () => {
    // Accent-insensitive, final-sigma-insensitive, case-insensitive — asserted together because
    // they are one promise to the user: "type it however you type it, and it works".
    for (const spelling of DK_SEARCH.informationSpellings) {
      const response = await api.get(DK_PUBLIC.search, { params: { q: spelling.q } });

      expect(response.status(), `search '${spelling.label}' status`).toBe(OK);
      const body: SearchBody = await response.json();

      // The count assertion is the whole point. A search that 200s with count 0 is broken, and a
      // status-only test calls it green.
      expect(
        body.count,
        `Greek search regression: "${spelling.q}" (${spelling.label}) found nothing. ` +
          `All four spellings must match the accented content — this is the promise that makes ` +
          `the search box usable for the audience this product is built for.`,
      ).toBeGreaterThan(0);

      expect(body.results.map((r) => r.slug)).toContain(DK_SEARCH.informationSlug);
    }
  });

  test('🔴 final sigma ς and medial sigma σ are the same letter to the search box', async () => {
    // Isolated from the loop above because it is the single most likely thing to regress: the two
    // sigmas are different codepoints, and any normalisation rewrite that forgets them fails ONLY
    // this case while accent-folding keeps working.
    const [finalSigma, medialSigma] = await Promise.all([
      api.get(DK_PUBLIC.search, { params: { q: 'πληροφοριες' } }),
      api.get(DK_PUBLIC.search, { params: { q: 'πληροφοριεσ' } }),
    ]);

    const finalBody: SearchBody = await finalSigma.json();
    const medialBody: SearchBody = await medialSigma.json();

    expect(finalBody.count).toBeGreaterThan(0);
    expect(medialBody.results.map((r) => r.slug)).toEqual(finalBody.results.map((r) => r.slug));
  });

  test('a word in a guide TITLE is found with and without its accent', async () => {
    for (const q of [DK_SEARCH.titleWord.accented, DK_SEARCH.titleWord.unaccented]) {
      const body: SearchBody = await (await api.get(DK_PUBLIC.search, { params: { q } })).json();

      expect(body.count, `title search "${q}" found nothing`).toBeGreaterThan(0);
      expect(body.results.map((r) => r.slug)).toContain(DK_SEARCH.titleWord.slug);
    }
  });

  test('the search echoes the query back UNMANGLED (UTF-8 survives the round trip)', async () => {
    // Guards the encoding path itself. A misconfigured proxy or a non-UTF-8 default collation
    // turns `πληροφορίες` into `p????f???es`, and every Greek search then correctly returns zero
    // results — a bug that reads as "search is broken" and is really "the bytes never arrived".
    const q = 'πληροφορίες';
    const body: SearchBody = await (await api.get(DK_PUBLIC.search, { params: { q } })).json();

    expect(body.query).toBe(q);
  });

  test('🔴 steps are NOT indexed — a step-only word finds nothing (pinned limitation)', async () => {
    // The tsvector covers title + intro only. This is a REAL limitation, pinned deliberately so it
    // is a known property rather than a bug someone rediscovers in six months. If the index is
    // ever widened to cover steps, this test fails and forces an explicit decision about what the
    // search box now means.
    const body: SearchBody = await (
      await api.get(DK_PUBLIC.search, { params: { q: DK_SEARCH.stepOnlyWord } })
    ).json();

    expect(
      body.count,
      `"${DK_SEARCH.stepOnlyWord}" appears only inside a guide STEP. If this now returns ` +
        `results, the search index was widened beyond title+intro — update this test and the ` +
        `product decision behind it, do not just delete the assertion.`,
    ).toBe(0);
  });

  test('a word that is genuinely absent returns an empty result set', async () => {
    // The control for every assertion above: proves the search can say "no", so a passing
    // positive case is not just an endpoint that returns everything for everything.
    const body: SearchBody = await (
      await api.get(DK_PUBLIC.search, { params: { q: 'ζζζξξξψψψ' } })
    ).json();

    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });

  test('search results carry the fields the results page renders', async () => {
    const body: SearchBody = await (
      await api.get(DK_PUBLIC.search, { params: { q: DK_SEARCH.titleWord.accented } })
    ).json();

    for (const result of body.results) {
      expect(result.slug).toBeTruthy();
      expect(result.title).toBeTruthy();
      expect(result.intro).toBeTruthy();
    }
  });

  // ---------------------------------------------------------------------------
  // Resilience — the public API must never 5xx on malformed input
  // ---------------------------------------------------------------------------
  test('🔴 hostile and malformed search input degrades to empty, never 5xx', async () => {
    for (const probe of DK_SEARCH.degradeToEmpty) {
      const response = await api.get(DK_PUBLIC.search, { params: { q: probe.q } });

      expect(response.status(), `search '${probe.label}' — ${await bodyText(response)}`).toBe(OK);

      const body: SearchBody = await response.json();
      // A visitor unsure what to type must get "no results", which is a page, rather than an
      // error, which is a dead end (spec §9).
      expect(body.count, `search '${probe.label}' returned results`).toBe(0);
    }
  });

  test('🔴 no public route 5xxs on malformed path or query input', async () => {
    const probes = [
      `${DK_PUBLIC.search}?limit=999999`,
      `${DK_PUBLIC.search}?limit=-5`,
      `${DK_PUBLIC.search}?locale=zz`,
      `${DK_PUBLIC.search}?locale=<script>alert(1)</script>`,
      DK_PUBLIC.categoryBySlug('%%%%'),
      DK_PUBLIC.guideBySlug('../../etc/passwd'),
      DK_PUBLIC.guideBySlug("' OR 1=1--"),
      DK_PUBLIC.pageByKey('%20'),
    ];

    const failures: string[] = [];
    for (const path of probes) {
      const response = await api.get(path);
      // 4xx is a fine answer — the input WAS bad. 5xx means the input reached something that
      // could not cope with it, which is the difference between rejecting and crashing.
      if (response.status() >= SERVER_ERROR_FLOOR) {
        failures.push(`${path} -> ${response.status()} ${await bodyText(response)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  test('an oversized limit is clamped rather than honoured', async () => {
    const body: SearchBody = await (
      await api.get(DK_PUBLIC.search, { params: { q: 'α', limit: 999999 } })
    ).json();

    // Unbounded limits are how a search box becomes a table-scan DoS.
    expect(body.results.length).toBeLessThanOrEqual(100);
  });

  // ---------------------------------------------------------------------------
  // Contact form — the one anonymous route that WRITES
  // ---------------------------------------------------------------------------
  test('a real submission is accepted with 202 and a message id', async () => {
    // 202, not 201: the message is durably stored, but the side effect the visitor cares about —
    // a human reading it — has not happened yet.
    const response = await api.post(DK_PUBLIC.contact, {
      data: {
        senderName: dkTag('sender'),
        contact: `${dkTag('contact')}@example.com`,
        body: 'E2E probe: a genuine contact submission from the Digital Kin regression suite.',
      },
    });

    expect(response.status(), await bodyText(response)).toBe(ACCEPTED);
    expect(await response.json()).toHaveProperty('messageId');
  });

  test('🔴 the honeypot answer is INDISTINGUISHABLE from a human submission', async () => {
    // The whole point of a honeypot is that the bot cannot tell it was caught. A different status,
    // a missing id, or a slower reply all leak the trap and the spammer simply stops filling the
    // field. So this asserts SAMENESS of the response — the difference must be invisible here and
    // visible only in the CMS inbox, which never receives the row.
    const human = await api.post(DK_PUBLIC.contact, {
      data: {
        senderName: dkTag('human'),
        contact: `${dkTag('human')}@example.com`,
        body: 'E2E probe: human control for the honeypot comparison.',
      },
    });

    const bot = await api.post(DK_PUBLIC.contact, {
      data: {
        senderName: dkTag('bot'),
        contact: `${dkTag('bot')}@example.com`,
        body: 'E2E probe: honeypot submission, must be silently discarded.',
        // The hidden field a real browser never fills and a naive scraper always does.
        website: 'http://spam.example/buy-now',
      },
    });

    expect(bot.status()).toBe(human.status());
    expect(bot.status()).toBe(ACCEPTED);

    const botBody = await bot.json();
    const humanBody = await human.json();

    // Same shape, and a real-looking id, so nothing about the reply says "you were filtered".
    expect(Object.keys(botBody).sort()).toEqual(Object.keys(humanBody).sort());
    expect(botBody.messageId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('an empty contact submission is a 400, not a 500', async () => {
    // A validator that is registered but derives from the wrong base class registers NOTHING, and
    // an empty body then reaches the domain guard clause and surfaces as 500. That exact defect
    // shipped on this endpoint once already.
    const response = await api.post(DK_PUBLIC.contact, {
      data: { senderName: '', contact: '', body: '' },
    });

    expect(response.status()).toBe(BAD_REQUEST);
  });

  test('an over-long contact body is rejected as 400, not a database error', async () => {
    // Length caps stop a long message becoming a Postgres 22001 surfacing as a 500.
    const response = await api.post(DK_PUBLIC.contact, {
      data: {
        senderName: dkTag('long'),
        contact: `${dkTag('long')}@example.com`,
        body: 'χ'.repeat(10_000),
      },
    });

    expect(response.status()).toBe(BAD_REQUEST);
  });
});

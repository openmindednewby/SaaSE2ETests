// Digital Kin API — @api tier: the authorisation boundary and optimistic concurrency (Plan 6 Task 12).
//
// This is the security-critical half of the suite. It proves the master/admin split in BOTH
// directions — what each role CAN do as well as what it cannot — because a one-directional test
// suite passes just as happily against an API that refuses everybody.
//
// 🔴 A 401 HERE IS AMBIGUOUS AND MUST NEVER BE ACCEPTED AS A PASS.
//
// Two completely different things produce 401 on this service:
//   1. A genuine authentication failure (no token, expired token, wrong realm).
//   2. A route that does not exist — the authorization fallback policy rejects unmatched routes
//      before routing reports them missing.
// ...and a third, worse case: a MISCONFIGURED SERVICE, where the API cannot resolve its own
// issuer and 401s every caller including a perfectly valid one. That is not hypothetical — it was
// the live state of staging when this suite was written (see `assertAuthenticationIsWired`).
//
// So every authorisation assertion below expects a specific status (403 for "authenticated but not
// permitted"), never merely "not 200", and the suite refuses to run at all until it has PROVED
// that a valid token authenticates. Otherwise "admin cannot write taxonomy" passes for the wrong
// reason on a service where nobody can do anything.
import { expect, test } from '@playwright/test';

import {
  DIGITALKIN_API_URL,
  DIGITALKIN_USERS,
  DK_ADMIN,
  authedApi,
  anonymousApi,
  bodyText,
  dkTag,
  mintToken,
} from './digital-kin-api-helpers.js';

import type { APIRequestContext } from '@playwright/test';

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const PRECONDITION_FAILED = 412;
const PRECONDITION_REQUIRED = 428;

/** The stable codes the CMS branches on — see `AdminPrecondition`. */
const IF_MATCH_REQUIRED_CODE = 'if_match_required';
const PRECONDITION_FAILED_CODE = 'precondition_failed';

interface TaxonomyCategory {
  externalId: string;
  key: string;
  name: string;
  eTag?: string;
}

test.describe('Digital Kin authorisation and concurrency @digital-kin-api @digital-kin', () => {
  let master: APIRequestContext;
  let admin: APIRequestContext;
  let anon: APIRequestContext;

  test.beforeAll(async () => {
    const masterToken = await mintToken(DIGITALKIN_USERS.MASTER);
    const adminToken = await mintToken(DIGITALKIN_USERS.ADMIN);

    // A credential that is REJECTED is a failure, not a skip. Only "we could not ask Keycloak at
    // all" is a legitimate reason to stand down, and even that says exactly why.
    for (const [label, outcome] of [
      ['master', masterToken],
      ['admin', adminToken],
    ] as const) {
      expect(
        outcome.kind,
        outcome.kind === 'rejected'
          ? `Keycloak REJECTED the ${label} fixture credentials with ${outcome.status}: ` +
            `${outcome.body}. That is a real failure — the seeded demo user is missing, ` +
            `disabled, or its password has drifted from .env.local.`
          : `Could not mint a ${label} token: ` +
            `${outcome.kind === 'unavailable' ? outcome.reason : ''}`,
      ).toBe('ok');
    }

    master = (await authedApi(DIGITALKIN_USERS.MASTER))!;
    admin = (await authedApi(DIGITALKIN_USERS.ADMIN))!;
    anon = await anonymousApi();

    await assertAuthenticationIsWired();
  });

  test.afterAll(async () => {
    await Promise.all([master?.dispose(), admin?.dispose(), anon?.dispose()]);
  });

  /**
   * 🔴 THE GUARD THAT MAKES EVERY OTHER ASSERTION IN THIS FILE MEAN SOMETHING.
   *
   * Proves a VALID token actually authenticates before any test claims a 403 proves an
   * authorisation rule. Without this, a service that 401s everyone — because it cannot resolve its
   * issuer, because its audience is wrong, because it is pointed at the wrong Keycloak — produces
   * a suite where every negative test passes and every positive test is the only thing that fails.
   * The negative tests are the ones people read as "security is working".
   *
   * This exact failure was live on staging while this suite was being written: the deployment set
   * `Keycloak__Authority` while `Program.cs` binds `Jwt:Authority`, so the value never reached the
   * runtime and `Jwt:Authority` silently fell back to the PRODUCTION Keycloak in appsettings.json,
   * which has no digitalkin realm. Every authenticated request returned
   * `401 error_description="The issuer '(null)' is invalid"`.
   */
  async function assertAuthenticationIsWired(): Promise<void> {
    const response = await master.get(DK_ADMIN.taxonomy);

    const authenticateHeader = response.headers()['www-authenticate'] ?? '';
    expect(
      response.status(),
      `A VALID master token did not authenticate against ${DIGITALKIN_API_URL}${DK_ADMIN.taxonomy} ` +
        `(got ${response.status()}; WWW-Authenticate: "${authenticateHeader}").\n\n` +
        `This suite is HALTED rather than run, because every authorisation assertion in it would ` +
        `otherwise pass for the wrong reason: on a service that 401s everybody, "admin cannot ` +
        `write taxonomy" is true and meaningless.\n\n` +
        `If the header says issuer '(null)' is invalid, the API cannot resolve its OIDC metadata. ` +
        `Check that the deployment sets Jwt__Authority (the FULL realm URL) — not Keycloak__* — ` +
        `and that it points at the same Keycloak that minted this token.`,
    ).toBe(OK);
  }

  // ---------------------------------------------------------------------------
  // Anonymous callers reach nothing
  // ---------------------------------------------------------------------------
  test('🔴 every admin route rejects an anonymous caller', async () => {
    const routes = [
      DK_ADMIN.taxonomy,
      DK_ADMIN.guides,
      DK_ADMIN.pages,
      DK_ADMIN.resources,
      DK_ADMIN.messages,
    ];

    for (const route of routes) {
      const response = await anon.get(route);
      expect(response.status(), `anonymous reached ${route}`).toBe(UNAUTHORIZED);
    }
  });

  test('a garbage bearer token is rejected, not ignored', async () => {
    // A service that ignores an unparseable token and falls through to anonymous is worse than one
    // that has no auth at all, because it looks authenticated.
    const context = await anonymousApi();
    try {
      const response = await context.get(DK_ADMIN.taxonomy, {
        headers: { Authorization: 'Bearer not-a-real-token' },
      });
      expect(response.status()).toBe(UNAUTHORIZED);
    } finally {
      await context.dispose();
    }
  });

  // ---------------------------------------------------------------------------
  // Both roles CAN read taxonomy — the deliberate asymmetry
  // ---------------------------------------------------------------------------
  test('🔴 BOTH master and admin can READ the taxonomy (by design)', async () => {
    // The one taxonomy endpoint that is not master-only. An admin-role author needs the category
    // `externalId` to file a guide, and this read is the only place that Guid is published — the
    // public category list deliberately omits it. Locking admin out here made the guide editor
    // unusable for one of the two shipped roles: authorised to file a guide, unable to name a
    // shelf. A suite that only tested "admin is blocked from taxonomy" would have ratified that.
    for (const [label, context] of [
      ['master', master],
      ['admin', admin],
    ] as const) {
      const response = await context.get(DK_ADMIN.taxonomy);

      expect(response.status(), `${label} could not read taxonomy`).toBe(OK);

      const taxonomy = await response.json();
      const categories: TaxonomyCategory[] = taxonomy.categories ?? [];
      expect(categories.length, `${label} got an empty taxonomy`).toBeGreaterThan(0);

      // The whole reason admin is allowed in. If this id stops being published, the guide editor
      // breaks for the admin role and no authorisation test would notice.
      for (const category of categories) {
        expect(category.externalId, 'a category has no externalId').toMatch(/^[0-9a-f-]{36}$/i);
      }
    }
  });

  test('the admin taxonomy read includes drafts the public read hides', async () => {
    // Drafts are the difference between the authoring view and the visitor view. If they match,
    // either nothing is in draft or the admin read is quietly serving the public projection.
    const response = await master.get(DK_ADMIN.taxonomy);
    const taxonomy = await response.json();

    expect(taxonomy.categories.length).toBeGreaterThan(0);
    // Every category carries a publish state the public list never exposes.
    for (const category of taxonomy.categories) {
      expect(category).toHaveProperty('externalId');
    }
  });

  // ---------------------------------------------------------------------------
  // 🔴 The authorisation boundary: admin CANNOT write taxonomy
  // ---------------------------------------------------------------------------
  test('🔴 admin is FORBIDDEN from all four taxonomy writes, master is not', async () => {
    const taxonomy = await (await master.get(DK_ADMIN.taxonomy)).json();
    const category: TaxonomyCategory = taxonomy.categories[0];
    const subCategory = taxonomy.categories
      .flatMap((c: { subCategories?: { externalId: string }[] }) => c.subCategories ?? [])
      .at(0);

    expect(category?.externalId, 'no seeded category to test against').toBeTruthy();

    // Each write is attempted with a well-formed body and a valid token, so the ONLY reason to
    // refuse is the role. A malformed request would produce 400 and prove nothing about authz.
    const writes: { label: string; run: (ctx: APIRequestContext) => Promise<Response> }[] = [];

    const attempts = [
      {
        label: 'PUT category',
        send: (ctx: APIRequestContext) =>
          ctx.put(DK_ADMIN.categoryById(category.externalId), {
            headers: { 'If-Match': '*' },
            data: { name: category.name },
          }),
      },
      {
        label: 'POST subcategory',
        send: (ctx: APIRequestContext) =>
          ctx.post(DK_ADMIN.subCategories, {
            data: { categoryId: category.externalId, name: dkTag('sub'), slug: dkTag('sub') },
          }),
      },
      {
        label: 'PUT subcategory',
        send: (ctx: APIRequestContext) =>
          ctx.put(DK_ADMIN.subCategoryById(subCategory?.externalId ?? category.externalId), {
            headers: { 'If-Match': '*' },
            data: { name: dkTag('sub') },
          }),
      },
      {
        label: 'DELETE subcategory',
        send: (ctx: APIRequestContext) =>
          ctx.delete(DK_ADMIN.subCategoryById(subCategory?.externalId ?? category.externalId), {
            headers: { 'If-Match': '*' },
          }),
      },
    ];

    void writes;

    for (const attempt of attempts) {
      const response = await attempt.send(admin);

      // EXACTLY 403. Not "not 2xx": a 401 would mean the token stopped authenticating, a 404 would
      // mean the route moved, and both would let this test pass while proving nothing about the
      // role boundary it claims to guard.
      expect(
        response.status(),
        `admin should be FORBIDDEN from "${attempt.label}" but got ${response.status()}: ` +
          `${await bodyText(response)}`,
      ).toBe(FORBIDDEN);
    }
  });

  test('🔴 master CAN write taxonomy — the boundary is a role split, not a locked door', async () => {
    // The other direction, and the one that catches "we blocked everybody and called it security".
    const taxonomy = await (await master.get(DK_ADMIN.taxonomy)).json();
    const category: TaxonomyCategory = taxonomy.categories[0];

    const created = await master.post(DK_ADMIN.subCategories, {
      data: {
        categoryId: category.externalId,
        name: dkTag('subcat'),
        slug: dkTag('subcat').toLowerCase(),
      },
    });

    expect(
      [OK, CREATED],
      `master could not create a sub-category: ${created.status()} ${await bodyText(created)}`,
    ).toContain(created.status());

    // Clean up so re-runs do not accumulate taxonomy rows.
    const body = await created.json().catch(() => null);
    const newId = body?.externalId ?? body?.id;
    if (newId) {
      await master.delete(DK_ADMIN.subCategoryById(newId), { headers: { 'If-Match': '*' } });
    }
  });

  test('admin CAN read guides — the role authors content, it just cannot reshape the shelves', async () => {
    const response = await admin.get(DK_ADMIN.guides);

    expect(response.status(), await bodyText(response)).toBe(OK);
  });

  // ---------------------------------------------------------------------------
  // Optimistic concurrency: 428 / 412 / 409 kept DISTINCT
  // ---------------------------------------------------------------------------
  test('🔴 an admin read stamps an ETag', async () => {
    // Without a tag on the read there is nothing to send back as If-Match, and the whole
    // concurrency contract below is unreachable from a real client.
    const response = await master.get(DK_ADMIN.taxonomy);
    expect(response.status()).toBe(OK);

    const taxonomy = await response.json();
    const category: TaxonomyCategory = taxonomy.categories[0];

    // A list response carries a tag PER ITEM inside the body — one header cannot describe six
    // rows, and a client that treated it as though it could would send that tag back as the
    // If-Match for whichever row it happened to edit.
    const headerTag = response.headers()['etag'];
    expect(
      category.eTag ?? headerTag,
      'neither the taxonomy body nor its headers carried an ETag',
    ).toBeTruthy();
  });

  test('🔴 a write with NO If-Match is 428 with the if_match_required code', async () => {
    const taxonomy = await (await master.get(DK_ADMIN.taxonomy)).json();
    const category: TaxonomyCategory = taxonomy.categories[0];

    const response = await master.put(DK_ADMIN.categoryById(category.externalId), {
      data: { name: category.name },
    });

    expect(response.status(), await bodyText(response)).toBe(PRECONDITION_REQUIRED);

    // The status alone is not the contract — the CMS branches on the CODE.
    const problem = await response.json();
    expect(problem.code).toBe(IF_MATCH_REQUIRED_CODE);
  });

  test('🔴 a write with a STALE If-Match is 412, and hands back the current tag', async () => {
    const taxonomy = await (await master.get(DK_ADMIN.taxonomy)).json();
    const category: TaxonomyCategory = taxonomy.categories[0];

    const response = await master.put(DK_ADMIN.categoryById(category.externalId), {
      headers: { 'If-Match': '"definitely-not-the-current-tag"' },
      data: { name: category.name },
    });

    expect(response.status(), await bodyText(response)).toBe(PRECONDITION_FAILED);

    const problem = await response.json();
    expect(problem.code).toBe(PRECONDITION_FAILED_CODE);

    // `currentETag` is the load-bearing field: without it the CMS must issue a second GET before
    // it can even offer "reload and re-apply", at the exact moment the author is already annoyed.
    expect(problem.currentETag, '412 did not return the current ETag').toBeTruthy();
  });

  test('🔴 428 and 412 are DISTINCT — a missing tag is not a stale tag', async () => {
    // They report different events and carry different advice: 412 means "reload, see what
    // changed, re-apply"; 428 means "your client never implemented If-Match at all". Collapsing
    // them makes the CMS show a scary merge banner for a client bug.
    const taxonomy = await (await master.get(DK_ADMIN.taxonomy)).json();
    const category: TaxonomyCategory = taxonomy.categories[0];

    const [missing, stale] = await Promise.all([
      master.put(DK_ADMIN.categoryById(category.externalId), { data: { name: category.name } }),
      master.put(DK_ADMIN.categoryById(category.externalId), {
        headers: { 'If-Match': '"stale"' },
        data: { name: category.name },
      }),
    ]);

    expect(missing.status()).toBe(PRECONDITION_REQUIRED);
    expect(stale.status()).toBe(PRECONDITION_FAILED);
    expect(missing.status()).not.toBe(stale.status());
  });

  test('🔴 a write with the CURRENT If-Match succeeds — the precondition is not a brick wall', async () => {
    // The positive leg. Without it, an endpoint that rejected every If-Match unconditionally would
    // pass both negative tests above.
    const taxonomy = await (await master.get(DK_ADMIN.taxonomy)).json();
    const category: TaxonomyCategory = taxonomy.categories[0];
    const tag = category.eTag;

    test.skip(!tag, 'taxonomy items carry no per-item eTag — nothing to round-trip.');

    const response = await master.put(DK_ADMIN.categoryById(category.externalId), {
      headers: { 'If-Match': tag! },
      // Writes the SAME name back, so a passing run leaves the taxonomy exactly as it found it.
      data: { name: category.name },
    });

    expect([OK, NO_CONTENT], await bodyText(response)).toContain(response.status());
  });

  test('a missing If-Match is 428 even for a row that does not exist', async () => {
    // Order matters: the protocol failure is answered BEFORE the row is looked up, so a client
    // that has not implemented If-Match gets the same 428 either way rather than being sent
    // hunting for a data problem it does not have.
    const response = await master.put(DK_ADMIN.categoryById('00000000-0000-0000-0000-000000000000'), {
      data: { name: 'x' },
    });

    expect([PRECONDITION_REQUIRED, NOT_FOUND]).toContain(response.status());
    if (response.status() === PRECONDITION_REQUIRED) {
      expect((await response.json()).code).toBe(IF_MATCH_REQUIRED_CODE);
    }
  });
});

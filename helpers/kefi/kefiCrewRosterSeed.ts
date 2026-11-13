import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { KefiAdminClient } from './kefiAdminClient.js';
import { getKefiUrls } from './kefiUrls.js';

const BFF_EVENTS_PATH = '/bff/api/kefi/api/v1/admin/events';
const HTTP_CREATED = 201;
const HTTP_REDIRECT_MIN = 300;
const SEED_PASS_CODE = 'CLASS';

export const ROW_MENU = '[data-testid^="organizer-crew-roster-actions-"][data-testid$="-overflow"]';
export const VIEW_MEMBER = 'View member';
export const COPY_LINK = 'Copy personal link';

/** Open the first roster row's action menu, where View member and the personal-link actions live. */
export async function openFirstRowMenu(page: Page): Promise<void> {
  const menu = page.locator(ROW_MENU).first();
  await menu.scrollIntoViewIfNeeded();
  await menu.click();
}

/** Resolve the organizer's first event externalId via the BFF read-model. */
export async function resolveEventExternalId(page: Page): Promise<string> {
  const { webUrl } = getKefiUrls();
  const res = await page.request.get(`${webUrl}${BFF_EVENTS_PATH}`, { headers: { 'X-BFF-Csrf': '1' } });
  expect(res.status(), 'the organizer events read-model returned OK').toBe(200);
  const body = (await res.json()) as { events: Array<{ externalId: string; name: string }> };
  expect(body.events.length, 'the fixture organizer owns at least one event').toBeGreaterThan(0);
  return body.events[0].externalId;
}

/** One promoter and one crew row seeded on an event, removed again by {@link CrewRosterSeed.removeAll}. */
export class CrewRosterSeed {
  private readonly created: string[] = [];
  private originalCompRules: unknown[] | undefined;

  private constructor(
    private readonly request: APIRequestContext,
    private readonly eventExternalId: string,
    private readonly bearer: string,
  ) {}

  static async create(
    request: APIRequestContext, eventExternalId: string, organizer: { email: string; password: string },
  ): Promise<CrewRosterSeed> {
    const seed = new CrewRosterSeed(request, eventExternalId, await new KefiAdminClient().getTenantOwnerBearer(organizer));
    const tag = Date.now().toString(36);
    await seed.add('promoters', { name: `E2E promoter ${tag}`, role: 'ambassador', headcount: 1 });
    await seed.add('crew', { name: `E2E crew ${tag}`, role: 'DJ', feeEur: 20 });
    await seed.ensureCompRule();
    return seed;
  }

  async removeAll(): Promise<void> {
    if (this.originalCompRules) await this.putCompRules(this.originalCompRules, 'comp rules restored');
    for (const path of this.created) {
      const res = await this.request.delete(`${this.eventPath()}/${path}`, { headers: this.auth() });
      expect.soft(res.status(), `seeded ${path} removed`).toBeLessThan(HTTP_REDIRECT_MIN);
    }
  }

  private async add(kind: 'promoters' | 'crew', data: Record<string, unknown>): Promise<void> {
    const res = await this.request.post(`${this.eventPath()}/${kind}`, { headers: this.auth(), data });
    expect(res.status(), `seed ${kind} row ${String(data.name)}: ${await res.text()}`).toBe(HTTP_CREATED);
    this.created.push(`${kind}/${((await res.json()) as { externalId: string }).externalId}`);
  }

  /** The commission breakdown has one line per comp rule; an event with none shows the empty state. */
  private async ensureCompRule(): Promise<void> {
    const res = await this.request.get(`${this.eventPath()}/comp-rules`, { headers: this.auth() });
    expect(res.status(), `read comp rules: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as unknown[] | { rules?: unknown[] };
    const rules = Array.isArray(body) ? body : body.rules ?? [];
    if (rules.length > 0) return;
    this.originalCompRules = rules;
    await this.putCompRules([{ passCode: SEED_PASS_CODE, venueShareEur: 10, organizerShareEur: 20, promoterShareEur: 5 }], 'seed comp rule');
  }

  private async putCompRules(rules: unknown[], what: string): Promise<void> {
    const res = await this.request.put(`${this.eventPath()}/comp-rules`, { headers: this.auth(), data: { rules } });
    expect.soft(res.status(), `${what}: ${await res.text()}`).toBeLessThan(HTTP_REDIRECT_MIN);
  }

  private eventPath(): string {
    return `${getKefiUrls().apiUrl}/api/v1/organizer/events/${this.eventExternalId}`;
  }

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.bearer}` };
  }
}

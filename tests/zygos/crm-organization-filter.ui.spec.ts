import path from 'path';

import { devices, expect, test } from '@playwright/test';
import { expectTextFits } from '@dloizides/game-e2e';

import { ModulesApi } from './zygos-console-modules.js';
import { PAGER_TEST_IDS, enterConsole, gotoScreen, id } from './zygos-console-ui.js';
import { ZYGOS_USERS, bodyText } from './zygos-helpers.js';
import { loginAs } from './zygos-session.js';

import type { Page, Response } from '@playwright/test';
import type { ContactDto, Paged } from './zygos-console-modules.js';

type ContactRow = ContactDto & { organizationName?: string | null };

const FILTERS = 'zygos-contacts-filters';
const SEARCH = 'zygos-contacts-search';
const ORGANIZATION_FILTER = 'zygos-contacts-organization-filter';
const ORGANIZATION_TRIGGER = `button${id(ORGANIZATION_FILTER)}`;
const TABLE = 'zygos-contacts-table';
const PAGER = 'zygos-contacts-pager';
const TABLE_HEAD = 'ui-data-table-head';
const ALL_ORGANIZATIONS_VALUE = '';
const DEFAULT_PAGE_SIZE = 50;
const FRAME_DIR = 'crm-org-frames';
const VISIBLE_TEXT = 'body *:not([id^="a11y-hint-"])';
const SEARCH_BOX = `input${id(SEARCH)}, ${id(SEARCH)} input`;

const { defaultBrowserType: _phoneBrowser, ...phoneDevice } = devices['Pixel 5'];
const { defaultBrowserType: _desktopBrowser, ...desktopDevice } = devices['Desktop Chrome'];
const VIEWPORTS = [
  { label: '360x640', width: 360, use: { ...phoneDevice, viewport: { width: 360, height: 640 } } },
  { label: '1280x800', width: 1280, use: { ...desktopDevice, viewport: { width: 1280, height: 800 } } },
];

const runTag = `e2eorg-${Date.now().toString(36)}`;
const fillerTag = `e2efill-${Date.now().toString(36)}`;
const ORG_A_NAME = `0 Hellenic Export Cooperative A ${runTag}`;
const ORG_B_NAME = `0 Hellenic Export Cooperative B ${runTag}`;
const PERSON_A_NAME = `Ada ${runTag}`;
const PERSON_B_NAME = `Bob ${runTag}`;
const TAGGED_CONTACT_COUNT = 4;

let api: ModulesApi;
let orgA: ContactDto;
let orgB: ContactDto;
let personA: ContactDto;
let personB: ContactDto;
const createdPeople: ContactDto[] = [];

async function create(body: Record<string, unknown>): Promise<ContactDto> {
  const res = await api.createContact(body);
  expect(res.status(), `create contact failed: ${await bodyText(res)}`).toBe(201);
  return (await res.json()) as ContactDto;
}

async function listedTotal(): Promise<number> {
  const res = await api.listContacts('?pageSize=1');
  expect(res.status(), `list contacts failed: ${await bodyText(res)}`).toBe(200);
  return ((await res.json()) as Paged<ContactDto>).totalCount;
}

function contactsListed(page: Page, matches: (query: URLSearchParams) => boolean): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname.endsWith('/contacts') && matches(url.searchParams);
  });
}

async function openList(page: Page, route: string): Promise<void> {
  await enterConsole(page, '/');
  await gotoScreen(page, route, FILTERS);
}

async function searchTag(page: Page): Promise<Response> {
  const listed = contactsListed(page, (query) => query.get('Search') === runTag);
  await page.locator(SEARCH_BOX).fill(runTag);
  return listed;
}

async function pickOrganization(page: Page, value: string): Promise<void> {
  await page.locator(ORGANIZATION_TRIGGER).click();
  await page.locator(id(`${ORGANIZATION_FILTER}-option-${value}`)).click();
}

async function readList(response: Response): Promise<Paged<ContactRow>> {
  expect(response.status(), `list contacts failed: ${await response.text()}`).toBe(200);
  return (await response.json()) as Paged<ContactRow>;
}

const row = (contact: ContactDto): string => id(`${TABLE}-row-${contact.externalId}`);
const organizationCell = (contact: ContactDto): string => id(`${TABLE}-row-${contact.externalId}-organization`);

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const session = await loginAs(ZYGOS_USERS.MAKER_A);
  expect(session, 'no session could be minted for the E2E fixture tenant').not.toBeNull();
  api = new ModulesApi(session!);

  orgA = await create({ displayName: ORG_A_NAME, kind: 'Organization' });
  orgB = await create({ displayName: ORG_B_NAME, kind: 'Organization' });
  personA = await create({
    displayName: PERSON_A_NAME,
    kind: 'Person',
    email: `long.contact.address.${runTag}@example.com`,
    organizationId: orgA.externalId,
  });
  personB = await create({ displayName: PERSON_B_NAME, kind: 'Person', organizationId: orgB.externalId });
  createdPeople.push(personA, personB);

  const fillersNeeded = Math.max(0, DEFAULT_PAGE_SIZE + 1 - (await listedTotal()));
  for (let index = 0; index < fillersNeeded; index += 1) {
    createdPeople.push(await create({ displayName: `Filler ${String(index)} ${fillerTag}`, kind: 'Person' }));
  }
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  for (const contact of [...createdPeople, orgA, orgB].filter(Boolean)) {
    const res = await api.deactivateContact(contact.externalId);
    if (!res.ok()) failures.push(`${contact.externalId}: ${String(res.status())}`);
  }
  expect(failures, 'contacts this spec created could not be archived').toEqual([]);
});

for (const viewport of VIEWPORTS) {
  test.describe(`CRM organization filter at ${viewport.label} @zygos-ui @ui`, () => {
    test.use(viewport.use);

    test(`AC-8 on page 2 at ${viewport.label}, picking an organization, sends OrganizationId, gets 200, narrows the list, returns to page 1`, async ({
      page,
    }) => {
      await openList(page, '/crm/contacts');
      const pageTwo = contactsListed(page, (query) => query.get('Page') === '2');
      await page.locator(`${id(PAGER)} ${id(PAGER_TEST_IDS.next)}`).click();
      await pageTwo;
      const narrowed = contactsListed(page, (query) => query.get('OrganizationId') === orgA.externalId);

      await pickOrganization(page, orgA.externalId);

      const response = await narrowed;
      const body = await readList(response);
      expect(new URL(response.url()).searchParams.get('Page')).toBe('1');
      expect(body.items.map((item) => item.displayName)).toEqual([PERSON_A_NAME]);
      await expect(page.locator(row(personA))).toBeVisible();
      await expect(page.locator(row(personB))).toHaveCount(0);
      await expect(page.locator(`${id(PAGER)} ${id(PAGER_TEST_IDS.info)}`)).toHaveText(/\b1\s*[–-]\s*1\s+of\s+1\b/);
    });

    test(`AC-8 with an organization picked at ${viewport.label}, choosing All organizations, clears the filter`, async ({
      page,
    }) => {
      await openList(page, '/crm/contacts');
      await searchTag(page);
      const narrowed = contactsListed(page, (query) => query.get('OrganizationId') === orgA.externalId);
      await pickOrganization(page, orgA.externalId);
      await narrowed;
      const cleared = contactsListed(page, (query) => query.get('Search') === runTag && !query.has('OrganizationId'));

      await pickOrganization(page, ALL_ORGANIZATIONS_VALUE);

      const response = await cleared;
      const body = await readList(response);
      expect(new URL(response.url()).searchParams.has('OrganizationId')).toBe(false);
      expect(body.totalCount).toBe(TAGGED_CONTACT_COUNT);
      await expect(page.locator(row(personB))).toBeVisible();
      await expect(page.locator(ORGANIZATION_TRIGGER)).toContainText('All organizations');
    });

    test(`AC-11 on the contacts list at ${viewport.label}, reading the search box, names organization in the placeholder and the hint`, async ({
      page,
    }) => {
      await openList(page, '/crm/contacts');

      const searchBox = page.locator(SEARCH_BOX);

      await expect(searchBox).toHaveAttribute('placeholder', 'Name, email, phone or organization');
      await expect(searchBox).toHaveAccessibleDescription('Searches by name, email, phone or organization');
    });

    const SCREENS = [
      { name: 'contacts', path: '/crm/contacts', hasColumn: true, sample: (): ContactDto => personA },
      { name: 'people', path: '/crm/people', hasColumn: true, sample: (): ContactDto => personA },
      { name: 'organizations', path: '/crm/organizations', hasColumn: false, sample: (): ContactDto => orgA },
    ];

    for (const screen of SCREENS) {
      test(`AC-12 ${screen.name} at ${viewport.label}, listing the tagged rows, ${screen.hasColumn ? 'shows' : 'omits'} Organization and no text overflows`, async ({
        page,
      }, testInfo) => {
        await openList(page, screen.path);
        const sample = screen.sample();

        await searchTag(page);

        await expect(page.locator(row(sample))).toBeVisible();
        if (screen.hasColumn) {
          await expect(page.locator(organizationCell(sample))).toContainText(ORG_A_NAME);
          await expect(page.locator(ORGANIZATION_TRIGGER)).toBeVisible();
        } else {
          await expect(page.locator(organizationCell(sample))).toHaveCount(0);
          await expect(page.locator(ORGANIZATION_TRIGGER)).toHaveCount(0);
        }
        if (viewport.width >= 1280) {
          const head = expect(page.locator(id(TABLE_HEAD)));
          await (screen.hasColumn ? head.toContainText('Organization') : head.not.toContainText('Organization'));
        }
        await page.screenshot({
          path: path.join(testInfo.project.outputDir, FRAME_DIR, `${screen.name}-${String(viewport.width)}.png`),
          fullPage: true,
        });
        await expectTextFits(page, VISIBLE_TEXT);
      });
    }
  });
}

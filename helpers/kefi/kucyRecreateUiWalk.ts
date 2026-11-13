import { expect, type Page } from '@playwright/test';

import type { KefiLandingEditorPage } from '../../pages/kefi/KefiLandingEditorPage.js';

type Text = string | null;

interface Performer { name: string; role: Text; topic: Text; instagramUrl: Text }
interface Group { title: string; performers: Performer[] }
interface ScheduleClass { teacher: string; topic: Text; room: Text; level: Text }
interface Room { name: string; music: Text; dj: Text }
interface Book {
  title: string; subOpen: string; subClosed: string; contactHeading: string; contactPhone: string;
  revolut: { heading: string; url: string; urlLabel: string; qrImg: string };
  reference: { label: string; code: string };
  closed: { eyebrow: string; title: string; bodyHtml: string; meta: string };
}
interface WalkConfig {
  performerGroups: Group[];
  schedule: { title: string; slots: Array<{ time: string; classes: ScheduleClass[] }> };
  party: { title: string; rooms: Room[] };
  book: Book;
}

const GROUP_ADD = /^landing-artist-group-.+-add$/;
const GROUP_RENAME = /^landing-artist-group-.+-rename$/;
const GROUP_TITLE_INPUT = /^landing-artist-group-.+-title-input$/;
const BOOK = 'landing-form-book-pay';
const PERSON_TIMEOUT_MS = 15_000;

async function fillOptional(editor: KefiLandingEditorPage, testId: string, value: Text): Promise<void> {
  if (value) await editor.fill(testId, value);
}

async function ensureGroup(page: Page, index: number, title: string): Promise<void> {
  const adds = page.getByTestId(GROUP_ADD);
  if ((await adds.count()) <= index) {
    await page.getByTestId('landing-artist-add-group').click();
    await expect(adds, `people group ${String(index)} created`).toHaveCount(index + 1);
  }
  await page.getByTestId(GROUP_RENAME).nth(index).click();
  const input = page.getByTestId(GROUP_TITLE_INPUT).first();
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByTestId(GROUP_RENAME).nth(index), `group ${String(index)} renamed`).toBeVisible();
}

async function addPerson(page: Page, editor: KefiLandingEditorPage, groupIndex: number, person: Performer): Promise<void> {
  await page.getByTestId(GROUP_ADD).nth(groupIndex).click();
  await expect(page.getByTestId('landing-person-editor')).toBeVisible({ timeout: PERSON_TIMEOUT_MS });
  await editor.fill('landing-person-name', person.name);
  await fillOptional(editor, 'landing-person-role', person.role);
  await fillOptional(editor, 'landing-person-topic', person.topic);
  if (person.instagramUrl) {
    await editor.press('landing-person-link-add');
    await editor.fill('landing-person-link-0', person.instagramUrl);
  }
  await editor.press('landing-person-save');
  await expect(page.getByTestId('landing-person-editor'), `${person.name} saved`).toBeHidden({ timeout: PERSON_TIMEOUT_MS });
}

export async function walkPeople(page: Page, editor: KefiLandingEditorPage, config: unknown): Promise<void> {
  const c = config as WalkConfig;
  await editor.openSection('teachers');
  for (const [groupIndex, group] of c.performerGroups.entries()) {
    await ensureGroup(page, groupIndex, group.title);
    for (const person of group.performers) await addPerson(page, editor, groupIndex, person);
  }
}

export async function walkSchedule(editor: KefiLandingEditorPage, config: unknown): Promise<void> {
  const s = (config as WalkConfig).schedule;
  await editor.openSection('schedule');
  await editor.fill('landing-schedule-heading', s.title);
  for (const [i, slot] of s.slots.entries()) {
    const at = String(i);
    await editor.press('landing-schedule-slots-add');
    await editor.fill(`landing-schedule-${at}-time`, slot.time);
    for (const [j, item] of slot.classes.entries()) {
      const id = `landing-schedule-${at}-class-${String(j)}`;
      await editor.press(`landing-schedule-${at}-classes-add`);
      await editor.fill(`${id}-teacher`, item.teacher);
      await fillOptional(editor, `${id}-topic`, item.topic);
      await fillOptional(editor, `${id}-room`, item.room);
      await fillOptional(editor, `${id}-level`, item.level);
    }
  }
}

export async function walkParty(editor: KefiLandingEditorPage, config: unknown): Promise<void> {
  const p = (config as WalkConfig).party;
  await editor.openSection('party');
  await editor.fill('landing-party-heading', p.title);
  for (const [i, room] of p.rooms.entries()) {
    const at = String(i);
    await editor.press('landing-party-rooms-add');
    await editor.fill(`landing-party-${at}-name`, room.name);
    await fillOptional(editor, `landing-party-${at}-music`, room.music);
    await fillOptional(editor, `landing-party-${at}-dj`, room.dj);
  }
}

async function pickMethod(page: Page, method: string): Promise<void> {
  const chip = page.getByTestId(`${BOOK}-method-${method}`);
  const states = await Promise.all(['aria-checked', 'aria-selected', 'aria-pressed'].map((name) => chip.getAttribute(name)));
  if (!states.includes('true')) await chip.click();
}

export async function walkBookPay(page: Page, editor: KefiLandingEditorPage, config: unknown): Promise<void> {
  const b = (config as WalkConfig).book;
  await editor.openSection('settings');
  await editor.fill(`${BOOK}-title`, b.title);
  await editor.fill(`${BOOK}-subOpen`, b.subOpen);
  await pickMethod(page, 'whatsapp');
  await pickMethod(page, 'revolut');
  await editor.press(`${BOOK}-nav-next`);
  await editor.fill(`${BOOK}-contactHeading`, b.contactHeading);
  await editor.fill(`${BOOK}-contactPhone`, b.contactPhone);
  await editor.fill(`${BOOK}-revolutHeading`, b.revolut.heading);
  await editor.fill(`${BOOK}-revolutUrl`, b.revolut.url);
  await editor.fill(`${BOOK}-revolutUrlLabel`, b.revolut.urlLabel);
  await editor.fill(`${BOOK}-revolutQr`, b.revolut.qrImg);
  await editor.press(`${BOOK}-nav-next`);
  await editor.fill(`${BOOK}-refLabel`, b.reference.label);
  await editor.fill(`${BOOK}-refCode`, b.reference.code);
  await editor.press(`${BOOK}-nav-next`);
  await editor.fill(`${BOOK}-subClosed`, b.subClosed);
  await editor.fill(`${BOOK}-closedEyebrow`, b.closed.eyebrow);
  await editor.fill(`${BOOK}-closedTitle`, b.closed.title);
  await editor.fill(`${BOOK}-closedBody`, b.closed.bodyHtml);
  await editor.fill(`${BOOK}-closedMeta`, b.closed.meta);
}

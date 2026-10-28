import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SavedLandingDto } from './kefiKucyShapedConfig.types.js';

type Json = Record<string, unknown>;
interface Named { name: string }
interface Performer extends Named { photoUrl?: string | null }
interface Group { key: string; title?: string; performers: Performer[] }
interface Pass extends Named { price: string }
interface Poster { title: string; imageUrl: string; downloadUrl: string }
interface Link { label: string; url: string }

export interface KucyConfig {
  branding: { name: string; collapsedWordmark?: boolean | null; tagline: string; edition: string; logoUrl: string; navLogoUrl: string;
    heroImageUrl: string; primaryColor: string; accentColor: string };
  eventDetails: { classesTime: string; partyTime: string; locationLabel: string; description: string;
    heading: string; stats: Array<{ value: string; label: string }> };
  venue: { name: string; address: string };
  register: { secondaryLabel: string; secondaryUrl: string };
  sections: Array<{ key: string; title: string; body: string }>;
  performerGroups: Group[];
  schedule: { slots: Array<{ time: string }> };
  party: { rooms: Array<{ name: string; dj: string }> };
  socialLinks: Link[];
  passes: Pass[];
  addOns: Array<Named & { price: string; description: string }>;
  book: { title: string; contactPhone: string; revolut: { url: string }; reference: { code: string } };
  posters: Poster[];
  footer: { text: string; links: Link[] };
}

export interface KucyRecreateData { landing: SavedLandingDto; config: KucyConfig; navAnchors: string[]; unsourced: Json[] }

export interface MatrixRow { id: string; scenario: string; expected: string[] }

const DATA_FILE = join(__dirname, 'data', 'kucy-recreate.json');

export function loadKucyRecreate(): KucyRecreateData {
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as {
    landing: SavedLandingDto; rendered: { navAnchors: string[] }; unsourced: Json[];
  };
  const config = raw.landing.config as unknown as KucyConfig;
  return { landing: raw.landing, config, navAnchors: raw.rendered.navAnchors, unsourced: raw.unsourced };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtml(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

export function missingFrom(decodedHtml: string, expected: readonly string[]): string[] {
  return expected.filter((value) => !decodedHtml.includes(value));
}

const group = (c: KucyConfig, key: string): Group => {
  const found = c.performerGroups.find((g) => g.key === key);
  if (!found) throw new Error(`kucy-recreate has no performer group ${key}`);
  return found;
};
const section = (c: KucyConfig, key: string): { title: string; body: string } => {
  const found = c.sections.find((s) => s.key === key);
  if (!found) throw new Error(`kucy-recreate has no section ${key}`);
  return found;
};
const names = (items: readonly Named[]): string[] => items.map((i) => i.name);
const wordmark = (name: string, collapsed: boolean | null | undefined): string => {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  if (collapsed !== true || words.length < 2) return name;
  return words.map((w, i) => {
    const tail = w.slice(1) + (i === words.length - 1 ? '' : ' ');
    return tail.length === 0 ? w.slice(0, 1).toUpperCase() : `${w.slice(0, 1).toUpperCase()}<span class="brand-rest">${tail}</span>`;
  }).join('');
};

export function matrixRows(data: KucyRecreateData): MatrixRow[] {
  const c = data.config;
  const b = c.branding;
  const e = c.eventDetails;
  const teachers = group(c, 'teachers').performers;
  return [
    { id: 'CM-01', scenario: 'nav logo and anchor links', expected: [b.navLogoUrl, ...data.navAnchors.map((a) => `href="#${a}"`)] },
    { id: 'CM-02', scenario: 'collapsed wordmark', expected: [wordmark(b.name, b.collapsedWordmark)] },
    { id: 'CM-03', scenario: 'hero lockup image', expected: [b.logoUrl] },
    { id: 'CM-04', scenario: 'hero edition pill', expected: [b.edition] },
    { id: 'CM-05', scenario: 'hero styles line', expected: [b.tagline] },
    { id: 'CM-06', scenario: 'hero classes, party and location meta', expected: [e.classesTime, e.partyTime, e.locationLabel] },
    { id: 'CM-08', scenario: 'hero secondary CTA', expected: [c.register.secondaryLabel, `href="${c.register.secondaryUrl}"`] },
    { id: 'CM-10', scenario: 'mission heading and stat pillars', expected: [e.heading, ...e.stats.flatMap((s) => [s.value, s.label])] },
    { id: 'CM-11', scenario: 'teachers grid names and photos', expected: [...names(teachers), ...teachers.map((p) => p.photoUrl ?? '')] },
    { id: 'CM-13', scenario: 'classes schedule slots', expected: c.schedule.slots.map((s) => s.time) },
    { id: 'CM-14', scenario: 'party rooms and DJs', expected: c.party.rooms.flatMap((r) => [r.name, r.dj]) },
    { id: 'CM-15', scenario: 'price tiers', expected: c.passes.flatMap((p) => [p.name, p.price]) },
    { id: 'CM-25', scenario: 'pro video add-on in the register form', expected: c.addOns.flatMap((a) => [a.name, a.price]) },
    { id: 'CM-28', scenario: 'book and pay contact with WhatsApp link', expected: [c.book.title, `wa.me/${c.book.contactPhone.replace(/\D/g, '')}`] },
    { id: 'CM-29', scenario: 'book and pay Revolut link', expected: [c.book.revolut.url] },
    { id: 'CM-30', scenario: 'book and pay payment reference', expected: [c.book.reference.code] },
    { id: 'CM-32', scenario: 'ambassadors grid', expected: names(group(c, 'ambassadors').performers) },
    { id: 'CM-33', scenario: 'photo and video people', expected: names(group(c, 'media').performers) },
    { id: 'CM-34', scenario: 'pro video add-on card', expected: c.addOns.map((a) => a.description) },
    { id: 'CM-35', scenario: 'venue card', expected: [c.venue.name, c.venue.address] },
    { id: 'CM-37', scenario: 'posters with view and download', expected: c.posters.flatMap((p) => [p.title, p.imageUrl, p.downloadUrl]) },
    { id: 'CM-38', scenario: 'past editions untruncated', expected: [section(c, 'past').title, section(c, 'past').body] },
    { id: 'CM-39', scenario: 'social links', expected: c.socialLinks.map((l) => l.url) },
    { id: 'CM-40', scenario: 'footer organizer copy and links', expected: [c.footer.text, ...c.footer.links.map((l) => l.url)] },
    { id: 'CM-43', scenario: 'palette primary and accent', expected: [b.primaryColor, b.accentColor] },
    { id: 'CM-50', scenario: 'SEO description', expected: [`content="${e.description}"`] },
    { id: 'CM-51', scenario: 'og:image poster', expected: [b.heroImageUrl] },
  ];
}

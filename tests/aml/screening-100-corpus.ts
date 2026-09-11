// AM-READY-10 D-10.6 — the subject corpus for aml-screening-100-cases.spec.ts.
//
// Each subject is screened TWICE (adverse media ON and OFF), so SUBJECTS.length x 2 is the case
// count. The brief asks for >= 100 cases; the spec asserts that denominator, so trimming this list
// below 50 turns the suite red rather than silently shrinking the proof.
//
// `expect` is a SOFT precision/recall hint, never the point of the suite. The hard assertions are
// transport (no 5xx, no timeout), response shape, and the served adverseMediaStatus.
//   - 'hit'   : a sanctioned/PEP heavyweight screened by exact name; a clean result is suspicious.
//   - 'clean' : an invented name; a match here is a false positive worth reading.
//   - 'any'   : common names, typos, orgs, non-Latin — recorded, not graded.
//
// Single-token names carry a nationality ON PURPOSE: a lone mononym with no DoB and no nationality
// is FR-3 INSUFFICIENT_DATA (409, ScreeningController.cs:182-183) — a documented contract, not a
// defect — and the console's own form would send the nationality field the analyst filled in.

export const enum Expectation {
  Hit = 'hit',
  Clean = 'clean',
  Any = 'any',
}

export interface ScreeningSubject {
  readonly id: string;
  readonly fullName: string;
  readonly category: string;
  readonly expect: Expectation;
  readonly nationality?: string;
}

const s = (
  id: string,
  fullName: string,
  category: string,
  expect: Expectation,
  nationality?: string,
): ScreeningSubject => ({ id, fullName, category, expect, nationality });

const Hit = Expectation.Hit;
const Clean = Expectation.Clean;
const Any = Expectation.Any;

export const SUBJECTS: readonly ScreeningSubject[] = [
  // Sanctioned / PEP heavyweights. Putin first: the owner reported this exact screen erroring.
  s('pep-01', 'Vladimir Putin', 'sanctioned-pep', Hit),
  s('pep-02', 'Kim Jong Un', 'sanctioned-pep', Hit),
  s('pep-03', 'Nicolas Maduro', 'sanctioned-pep', Hit),
  s('pep-04', 'Bashar al-Assad', 'sanctioned-pep', Hit),
  s('pep-05', 'Ali Khamenei', 'sanctioned-pep', Hit),
  s('pep-06', 'Alexander Lukashenko', 'sanctioned-pep', Hit),
  s('pep-07', 'Ramzan Kadyrov', 'sanctioned-pep', Hit),
  s('pep-08', 'Sergei Lavrov', 'sanctioned-pep', Hit),
  s('pep-09', 'Min Aung Hlaing', 'sanctioned-pep', Hit),
  s('pep-10', 'Roman Abramovich', 'sanctioned-pep', Hit),
  // People very likely in recent crime-themed news (the adverse-media stage's real workload).
  s('crime-01', 'Sam Bankman-Fried', 'crime-news', Any),
  s('crime-02', 'Joaquin Guzman', 'crime-news', Any),
  s('crime-03', 'Ovidio Guzman Lopez', 'crime-news', Any),
  s('crime-04', 'Do Kwon', 'crime-news', Any),
  s('crime-05', 'Jho Low', 'crime-news', Any),
  s('crime-06', 'Changpeng Zhao', 'crime-news', Any),
  s('crime-07', 'Ruja Ignatova', 'crime-news', Any),
  s('crime-08', 'Andrew Tate', 'crime-news', Any),
  // Very common names: the candidate-set / reviewer-workload stressors.
  s('common-01', 'John Smith', 'common', Any),
  s('common-02', 'Maria Garcia', 'common', Any),
  s('common-03', 'Mohammed Ali', 'common', Any),
  s('common-04', 'David Johnson', 'common', Any),
  s('common-05', 'Wei Zhang', 'common', Any),
  s('common-06', 'Ana Silva', 'common', Any),
  // Invented names: expected clean.
  s('rare-01', 'Zyxwort Quibbleflap', 'made-up', Clean),
  s('rare-02', 'Thaddeus Merriwhistle-Vonk', 'made-up', Clean),
  s('rare-03', 'Ossian Pellucid Drabkin', 'made-up', Clean),
  s('rare-04', 'Ymbrine Fescue-Holloway', 'made-up', Clean),
  s('rare-05', 'Qorvath Elundine', 'made-up', Clean),
  s('rare-06', 'Brannoc Ivelsquire', 'made-up', Clean),
  // Diacritics and non-Latin scripts.
  s('script-01', 'Łukasz Wiśniewski', 'diacritics', Any),
  s('script-02', 'Jürgen Müller', 'diacritics', Any),
  s('script-03', 'Владимир Путин', 'non-latin', Any),
  s('script-04', '习近平', 'non-latin', Any),
  s('script-05', 'Nicolás Maduro Moros', 'diacritics', Any),
  s('script-06', 'Recep Tayyip Erdoğan', 'diacritics', Any),
  s('script-07', 'محمد بن سلمان', 'non-latin', Any),
  s('script-08', '김정은', 'non-latin', Any),
  // Typos of famous names (the fuzzy path).
  s('typo-01', 'Vladimir Puttin', 'typo', Any),
  s('typo-02', 'Kim Jong Uhn', 'typo', Any),
  s('typo-03', 'Nicolas Madur', 'typo', Any),
  s('typo-04', 'Bashar al Asad', 'typo', Any),
  s('typo-05', 'Aleksandr Lukashenka', 'typo', Any),
  s('typo-06', 'Ramzan Kadirov', 'typo', Any),
  // Organisations. ScreeningCheckRequest has NO entity-type field (apps/aml-v2/src/api/types.ts),
  // so an organisation is screened exactly as the console would: its name in fullName.
  s('org-01', 'Wagner Group', 'organisation', Any),
  s('org-02', 'Rosneft', 'organisation', Any, 'RU'),
  s('org-03', 'Hezbollah', 'organisation', Any, 'LB'),
  s('org-04', 'Bank Melli Iran', 'organisation', Any),
  s('org-05', 'Sinaloa Cartel', 'organisation', Any),
  // Single-token names (with nationality — see header).
  s('mono-01', 'Putin', 'single-token', Any, 'RU'),
  s('mono-02', 'Maduro', 'single-token', Any, 'VE'),
  // Very long names.
  s('long-01', 'Maximilian Alexander Friedrich Wilhelm von Hohenzollern-Sigmaringen der Jüngere', 'long', Any),
  s('long-02', 'Muhammad bin Rashid bin Saeed bin Maktoum bin Hasher Al Maktoum', 'long', Any),
];

/** The heavyweight + crime-news subjects the STRESS test cycles through (the AM stage's hard path). */
export const STRESS_SUBJECTS: readonly string[] = SUBJECTS.filter(
  subject => subject.category === 'sanctioned-pep' || subject.category === 'crime-news',
).map(subject => subject.fullName);

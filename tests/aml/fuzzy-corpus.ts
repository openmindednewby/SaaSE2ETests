// AM-READY-5 §3.2 — the FROZEN corpus + named variant book for fuzzy recall/precision.
//
// CORPUS (A5-9): a mirror of `PROOViD/AMLService/AMLService.E2ETests/sample-corpus.tsv`
// (40 rows: 24 WIKIDATA pep + 16 OFAC/UK sanction), copied 2026-09-11. It is a SIBLING of that
// file, not an extension of it — the .tsv lives in a repo this tier must not write to, so the rows
// are frozen here and the revision string below travels into every failure message (A5-14).
//
// 🔴 WHY MATCHING IS BY NAME, NOT externalId. The same person carries a DIFFERENT externalId per
// source list: the .tsv records Ramzan Kadyrov as UK/13042, and the live service returns him as
// EU/7405. An externalId assertion would therefore fail on list provenance rather than on matching
// quality. The hit rule is exact equality of the NORMALISED `matchedName` against the normalised
// corpus name — strict enough that a near-miss does not count as recall.
//
// 🔴 A5-13: no literal blocking key appears here as expected behaviour. The doc records the literal
// key at 43-87% recall with a 596-vs-244 candidate expansion; nothing in this file pins it.

export const CORPUS_REVISION =
  'sample-corpus.tsv@2026-09-11 / 40 rows (24 WIKIDATA pep + 16 OFAC|UK sanction)';

/** The 40 frozen corpus names, verbatim from the .tsv (column 2), casing included. */
export const CORPUS_NAMES: readonly string[] = [
  'Oleg Tatarinov', 'Wilkes Angel', 'Sajjad Lone', 'Emperor Yang of Sui', 'Willi Aberer',
  'Alex Kwablah', 'Iurie Chirinciuc', 'Andrew O. Skaar', 'Ben Bradshaw', 'Halima Tayo Alao',
  'Carlos Henriquez', "Mohammad Al-Zo'bi", 'Sergo Yeritsyan', 'Beth Anne Billings', 'John Malet',
  'Sviatoslav Vakarchuk', 'J.F.G. Knorr', 'Rumen Nikolov', 'Markus Hutter',
  'Pedro Carlos Olaechea', 'John Francklyn', 'Johann Mahal', 'Henry Savile', 'Raj Babbar',
  'Deshan CAI', 'Amin ABU RASHED', 'Dmitry Evgenyevich SHUGAYEV', 'Rogelio GONZALEZ PIZANA JR.',
  'Mushtaq Talib Zughayr AL-RAWI', 'Ramzan Akhmadovitch KADYROV', 'Michel DJOTODIA',
  'Alexander Yegorovich NATALENKO', 'PAK BONG NAM', 'Luis Eduardo PARRA RIVERO',
  'Viktor Borisovich NETYKSHO', 'Alexander Alexandrovich SAVIN', 'Sara GRIMBERG DE GUBEREK',
  'Vitaly Vladimirovich NESKORODOV', 'Raquel RIVERA GUERRERO', 'Ms Ayman KADIROVA',
];

/** The six variant classes §3.2 names as the ones that actually break. */
export const enum VariantClass {
  Transliteration = 'transliteration',
  OrderInversion = 'name-order-inversion',
  Initials = 'initials-vs-full-given-name',
  Diacritics = 'diacritics',
  Hyphenation = 'hyphenation-and-punctuation',
  CaseAndSpacing = 'case-and-spacing',
}

export interface VariantCase {
  /** What a user types. */
  readonly query: string;
  /** The corpus row it must still reach (verbatim from CORPUS_NAMES). */
  readonly expects: string;
  readonly klass: VariantClass;
}

/**
 * The NAMED variant book. Every row is a real corpus entity plus one deliberate distortion; the
 * distortion class is recorded so a failure names WHICH class collapsed, not just "recall fell".
 */
export const VARIANT_CASES: readonly VariantCase[] = [
  // --- transliteration: the same Cyrillic/Arabic name romanised by a different convention ---
  { query: 'Ramzan Akhmadovich Kadirov', expects: 'Ramzan Akhmadovitch KADYROV', klass: VariantClass.Transliteration },
  { query: 'Dmitriy Evgenevich Shugaev', expects: 'Dmitry Evgenyevich SHUGAYEV', klass: VariantClass.Transliteration },
  { query: 'Svyatoslav Vakarchuk', expects: 'Sviatoslav Vakarchuk', klass: VariantClass.Transliteration },
  { query: 'Viktor Borisovitch Netiksho', expects: 'Viktor Borisovich NETYKSHO', klass: VariantClass.Transliteration },
  { query: 'Aiman Kadirova', expects: 'Ms Ayman KADIROVA', klass: VariantClass.Transliteration },
  { query: 'Vitaliy Vladimirovitch Neskorodov', expects: 'Vitaly Vladimirovich NESKORODOV', klass: VariantClass.Transliteration },
  { query: 'Mohammed Al-Zobi', expects: "Mohammad Al-Zo'bi", klass: VariantClass.Transliteration },

  // --- name-order inversion: surname first, the default in half the world's forms ---
  { query: 'Lone Sajjad', expects: 'Sajjad Lone', klass: VariantClass.OrderInversion },
  { query: 'Bradshaw Ben', expects: 'Ben Bradshaw', klass: VariantClass.OrderInversion },
  { query: 'Babbar Raj', expects: 'Raj Babbar', klass: VariantClass.OrderInversion },
  { query: 'Hutter Markus', expects: 'Markus Hutter', klass: VariantClass.OrderInversion },
  { query: 'Tatarinov Oleg', expects: 'Oleg Tatarinov', klass: VariantClass.OrderInversion },
  { query: 'KADYROV Ramzan Akhmadovitch', expects: 'Ramzan Akhmadovitch KADYROV', klass: VariantClass.OrderInversion },

  // --- initials vs full given name: what a wire message or a bank statement actually carries ---
  { query: 'S. Lone', expects: 'Sajjad Lone', klass: VariantClass.Initials },
  { query: 'B. Bradshaw', expects: 'Ben Bradshaw', klass: VariantClass.Initials },
  { query: 'R. Babbar', expects: 'Raj Babbar', klass: VariantClass.Initials },
  { query: 'M. Hutter', expects: 'Markus Hutter', klass: VariantClass.Initials },
  { query: 'D. E. Shugayev', expects: 'Dmitry Evgenyevich SHUGAYEV', klass: VariantClass.Initials },

  // --- diacritics: the query carries marks the list row does not ---
  { query: 'Sérgo Yeritsyán', expects: 'Sergo Yeritsyan', klass: VariantClass.Diacritics },
  { query: 'Rúmen Nikolóv', expects: 'Rumen Nikolov', klass: VariantClass.Diacritics },
  { query: 'Márkus Hütter', expects: 'Markus Hutter', klass: VariantClass.Diacritics },
  { query: 'Pédro Cárlos Oláechea', expects: 'Pedro Carlos Olaechea', klass: VariantClass.Diacritics },
  { query: 'Michél Djotodía', expects: 'Michel DJOTODIA', klass: VariantClass.Diacritics },

  // --- hyphenation and punctuation: hyphen<->space, dropped periods, apostrophes ---
  { query: 'Mushtaq Talib Zughayr Al Rawi', expects: 'Mushtaq Talib Zughayr AL-RAWI', klass: VariantClass.Hyphenation },
  { query: 'Rogelio Gonzalez-Pizana Jr', expects: 'Rogelio GONZALEZ PIZANA JR.', klass: VariantClass.Hyphenation },
  { query: 'Sara Grimberg-de-Guberek', expects: 'Sara GRIMBERG DE GUBEREK', klass: VariantClass.Hyphenation },
  { query: "Mohammad AlZo'bi", expects: "Mohammad Al-Zo'bi", klass: VariantClass.Hyphenation },
  { query: 'J.F.G Knorr', expects: 'J.F.G. Knorr', klass: VariantClass.Hyphenation },
  { query: 'Pak-Bong-Nam', expects: 'PAK BONG NAM', klass: VariantClass.Hyphenation },

  // --- case and spacing: the cheapest class; a miss here is a normalisation defect ---
  { query: 'pak bong nam', expects: 'PAK BONG NAM', klass: VariantClass.CaseAndSpacing },
  { query: '  deshan   cai ', expects: 'Deshan CAI', klass: VariantClass.CaseAndSpacing },
  { query: 'amin abu rashed', expects: 'Amin ABU RASHED', klass: VariantClass.CaseAndSpacing },
  { query: 'LUIS EDUARDO PARRA RIVERO', expects: 'Luis Eduardo PARRA RIVERO', klass: VariantClass.CaseAndSpacing },
];

/**
 * 🔴 THE NEGATIVE CONTROL (precision). Invented names that share no surname token with any list
 * entity. A recall suite with no precision case passes an engine that matches everything, which is
 * the exact failure mode the 596-vs-244 candidate expansion produced.
 */
export const NEGATIVE_CONTROLS: readonly string[] = [
  'Zephyrine Qualtrough-Vandersloot',
  'Bartholomew Quintwistle',
  'Ignatius Fernsby-Wraith',
];

/**
 * Common-name false-positive controls. These MAY legitimately match (real people carry these
 * names), so they are not asserted to zero — they are asserted to a REVIEWABLE match-set size.
 */
export const COMMON_NAME_CONTROLS: readonly string[] = ['John Smith', 'Maria Garcia'];

const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

/** Fold for comparison only: strip diacritics, lowercase, reduce punctuation to single spaces. */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALNUM, ' ')
    .trim();
}

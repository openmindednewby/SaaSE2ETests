// The discriminator AM-E2E-5 lacked: "can the adverse-media pipeline SEE these names at all?"
//
// 🔴 WHY THIS IS NOT THE VACUITY IT REPLACES. AM-E2E-3 skips on `amMatches.length === 0`
// (aml-adverse-media.spec.ts:186) — it keys the skip to the SAME observable it is asserting, so
// "there was nothing to find" and "it was found and then dropped" collapse into one outcome. This
// probe keys on a DIFFERENT observable: the tenant's monitored-subject roster
// (GET /v1/monitoring/subjects) and the slice-tailer's own per-slice history
// (GET /v1/jobs/adverse-media-slice-tail/history). A corpus subject on the roster, with at least one
// slice PROCESSED after it was enrolled, makes a corpus-wide zero a HARD FAILURE and never a skip.
//
// 🔴 WHAT THIS PROBE CANNOT SEE — the asymmetry is deliberate. The tailer's watch book is built from
// EVERY tenant's MonitoredSubjects via IgnoreQueryFilters (AdverseMediaSliceTailService.BuildBookAsync)
// plus the screened names in MediaLookups (IncludeScreenedNames is already true,
// AdverseMediaSliceTailOptions.cs:90). GET /v1/monitoring/subjects is TENANT-SCOPED, and NO endpoint
// exposes the book itself. The roster is therefore a STRICT SUBSET of the book: presence on it proves
// book membership, absence proves only "not observable from this tenant's credentials". The ruling
// below is built on exactly that asymmetry — the hard failure fires on POSITIVE evidence, the
// no-input outcome fires on the absence of it, and the no-input text says which of the two it is.
import { amlGet } from './aml-helpers.js';

const MONITORED_SUBJECTS_PATH = '/v1/monitoring/subjects';
const SLICE_HISTORY_PATH = '/v1/jobs/adverse-media-slice-tail/history?take=50';
/** The three-valued slice outcome (AdverseMediaSliceHistoryController: processed | slice_absent | lease_lost). */
const PROCESSED = 'processed';
const OK = 200;

interface MonitoredSubjectRow {
  fullName?: string | null;
  createdAt?: string | null;
}
interface SliceRunRow {
  outcome?: string | null;
  finishedAt?: string | null;
}

/** What the two read-only probe endpoints actually reported. Every field is an OBSERVATION, not a verdict. */
export interface AmNameBookProbe {
  /** How many monitored subjects this tenant's credentials can see. A SUBSET of the tailer's book. */
  rosterSize: number;
  /** The corpus names observed on that roster — the only names this probe can PROVE are in the book. */
  observedCorpusNames: string[];
  /** Earliest enrolment among `observedCorpusNames`; null when none were observed. */
  earliestCorpusEnrolledAt: string | null;
  /** FinishedAt of the newest slice the tailer actually PROCESSED; null when it has processed none. */
  newestProcessedSliceAt: string | null;
  /** Non-null when a probe endpoint could not be read — the probe itself is then the unknown. */
  probeError: string | null;
}

/** The adjudication. `mustAssert` false means the control HAS NO INPUT and did not get to run. */
export interface AmCorpusRuling {
  mustAssert: boolean;
  reason: string;
}

const normalise = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function readJson<T>(
  request: Parameters<typeof amlGet>[0],
  path: string,
): Promise<{ rows: T[]; error: string | null }> {
  const res = await amlGet(request, path);
  if (!res) return { rows: [], error: `${path} unreachable` };
  if (res.status() !== OK) return { rows: [], error: `${path} returned ${res.status()}` };
  const body = (await res.json()) as T[] | { items?: T[] };
  const rows = Array.isArray(body) ? body : (body.items ?? []);
  return { rows, error: null };
}

/**
 * Ask the two endpoints that can answer "is any corpus subject in the indexed name book, and has the
 * tailer scanned anything since it got there". Never throws: a probe that cannot read is reported as
 * `probeError`, which is its own outcome — an unreadable probe must not silently look like "no data".
 */
export async function probeAmNameBook(
  request: Parameters<typeof amlGet>[0],
  corpus: string[],
): Promise<AmNameBookProbe> {
  const roster = await readJson<MonitoredSubjectRow>(request, MONITORED_SUBJECTS_PATH);
  const history = await readJson<SliceRunRow>(request, SLICE_HISTORY_PATH);

  const wanted = new Set(corpus.map(normalise));
  const onRoster = roster.rows.filter(row => wanted.has(normalise(String(row.fullName ?? ''))));
  const enrolments = onRoster
    .map(row => row.createdAt ?? '')
    .filter(stamp => stamp.length > 0)
    .sort();

  const processedStamps = history.rows
    .filter(row => row.outcome === PROCESSED)
    .map(row => row.finishedAt ?? '')
    .filter(stamp => stamp.length > 0)
    .sort();

  const errors = [roster.error, history.error].filter(Boolean);
  return {
    rosterSize: roster.rows.length,
    observedCorpusNames: onRoster.map(row => String(row.fullName ?? '')),
    earliestCorpusEnrolledAt: enrolments[0] ?? null,
    newestProcessedSliceAt: processedStamps[processedStamps.length - 1] ?? null,
    probeError: errors.length > 0 ? errors.join('; ') : null,
  };
}

const DID_NOT_TEST =
  'AM-E2E-5 DID NOT TEST WHAT IT EXISTS TO TEST: it exists to catch adverse-media matches being ' +
  'stripped between collection and the screening payload, and it never got an input to observe that on. ';

/**
 * Split the two worlds the single red conflated.
 *
 * World B (mustAssert) — a corpus subject IS provably in the book and slices were scanned after it
 * got there, so a corpus-wide zero is the real defect. World A (!mustAssert) — the stage is on but
 * the corpus is not observably in the book, or the tailer has scanned nothing since it arrived; the
 * control has no input. NOTE the caller must still let a NON-ZERO match total pass in either world:
 * this ruling only decides what a ZERO means.
 */
export function ruleOnAmCorpus(probe: AmNameBookProbe): AmCorpusRuling {
  if (probe.probeError) {
    return {
      mustAssert: false,
      reason:
        `${DID_NOT_TEST}The name-book probe itself could not be read (${probe.probeError}), so ` +
        '"the corpus is absent from the book" and "the corpus is present and its matches were ' +
        'dropped" are still indistinguishable. This is an UNKNOWN, not an absence.',
    };
  }

  if (probe.observedCorpusNames.length === 0) {
    return {
      mustAssert: false,
      reason:
        `${DID_NOT_TEST}No golden-corpus subject is on the monitored-subject roster this tenant can ` +
        `see (roster holds ${probe.rosterSize} subject(s), none of them corpus). The tailer's watch ` +
        'book is a SUPERSET of that roster (it spans every tenant plus MediaLookups screened names) ' +
        'and no endpoint exposes it, so this is "not observable from here", NOT proof the corpus is ' +
        'absent. Enrol a corpus subject and this outcome disappears on its own.',
    };
  }

  if (!probe.newestProcessedSliceAt) {
    return {
      mustAssert: false,
      reason:
        `${DID_NOT_TEST}Corpus subject(s) [${probe.observedCorpusNames.join(', ')}] ARE on the roster, ` +
        'but the slice-tailer has no PROCESSED slice in its history at all — nothing has been scanned ' +
        'for them yet.',
    };
  }

  if (
    probe.earliestCorpusEnrolledAt &&
    probe.newestProcessedSliceAt <= probe.earliestCorpusEnrolledAt
  ) {
    return {
      mustAssert: false,
      reason:
        `${DID_NOT_TEST}Corpus subject(s) [${probe.observedCorpusNames.join(', ')}] were enrolled at ` +
        `${probe.earliestCorpusEnrolledAt}, and the newest PROCESSED slice finished at ` +
        `${probe.newestProcessedSliceAt} — before that. No slice has been scanned against them yet, so ` +
        'a zero here is arithmetic, not evidence.',
    };
  }

  return {
    mustAssert: true,
    reason:
      `corpus subject(s) [${probe.observedCorpusNames.join(', ')}] ARE in the indexed name book ` +
      `(monitored-subject roster, enrolled ${probe.earliestCorpusEnrolledAt ?? 'unknown'}), the ` +
      `slice-tailer PROCESSED a slice at ${probe.newestProcessedSliceAt} after that, and the ` +
      'adverse-media stage reports itself AVAILABLE — yet the screening payload carried zero ' +
      'adverse-media matches for the whole corpus. The name was watched, slices were scanned against ' +
      'it, and nothing reached the wire: the collection leg is broken, or matches are being stripped ' +
      'before the screening payload is serialised.',
  };
}
